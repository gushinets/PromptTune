"""Durable monthly quota. All mutations serialize on the installation quota row."""

import calendar
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import RateLimitInfo
from app.config import settings
from app.db.models import ImprovementQuota, Installation, QuotaReservation

MOSCOW = ZoneInfo("Europe/Moscow")


def period_boundary(anchor: datetime, months: int) -> datetime:
    local = anchor.astimezone(MOSCOW)
    year, month0 = divmod(local.year * 12 + local.month - 1 + months, 12)
    day = min(local.day, calendar.monthrange(year, month0 + 1)[1])
    return datetime(year, month0 + 1, day, tzinfo=MOSCOW).astimezone(UTC)


class QuotaService:
    def __init__(self, db: AsyncSession, now: Callable[[], datetime] | None = None):
        self.db = db
        self.now = now or (lambda: datetime.now(UTC))

    async def register(self, installation_id: str, installed_at: datetime) -> None:
        # Offline retries retain the recorded install time; neither retries nor future
        # client clocks may move an established server anchor.
        anchor = min(installed_at, self.now())
        await self.db.execute(
            insert(Installation)
            .values(id=installation_id, created_at=anchor)
            .on_conflict_do_nothing(index_elements=["id"])
        )
        await self.db.commit()

    async def locked(self, installation_id: str) -> ImprovementQuota:
        now = self.now()
        await self.db.execute(
            insert(Installation)
            .values(id=installation_id, created_at=now)
            .on_conflict_do_nothing(index_elements=["id"])
        )
        anchor = (
            await self.db.execute(
                select(Installation.created_at).where(Installation.id == installation_id)
            )
        ).scalar_one()
        await self.db.execute(
            insert(ImprovementQuota)
            .values(
                installation_id=installation_id,
                anchor_at=anchor,
                period_start=anchor,
                next_reset_at=period_boundary(anchor, 1),
                remaining=50,
                total=50,
                bonus_claimed=False,
                email_verified=False,
                challenge_attempts=0,
            )
            .on_conflict_do_nothing(index_elements=["installation_id"])
        )
        quota = (
            await self.db.execute(
                select(ImprovementQuota)
                .where(ImprovementQuota.installation_id == installation_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        # Lock waits can cross midnight: all period/expiry decisions use lock acquisition time.
        now = self.now()
        if now >= quota.next_reset_at:
            local, origin = now.astimezone(MOSCOW), quota.anchor_at.astimezone(MOSCOW)
            months = (local.year - origin.year) * 12 + local.month - origin.month
            if period_boundary(quota.anchor_at, months) > now:
                months -= 1
            quota.period_start = period_boundary(quota.anchor_at, months)
            quota.next_reset_at = period_boundary(quota.anchor_at, months + 1)
            quota.remaining = quota.total = 50
        expired = (
            (
                await self.db.execute(
                    select(QuotaReservation).where(
                        QuotaReservation.installation_id == installation_id,
                        QuotaReservation.status == "pending",
                        QuotaReservation.expires_at <= now,
                    )
                )
            )
            .scalars()
            .all()
        )
        for reservation in expired:
            reservation.status = "expired"
            if reservation.period_start == quota.period_start:
                quota.remaining += 1
        await self.db.flush()
        return quota

    async def info(self, quota: ImprovementQuota) -> RateLimitInfo:
        pending = (
            await self.db.execute(
                select(func.count())
                .select_from(QuotaReservation)
                .where(
                    QuotaReservation.installation_id == quota.installation_id,
                    QuotaReservation.period_start == quota.period_start,
                    QuotaReservation.status == "pending",
                )
            )
        ).scalar_one()
        return RateLimitInfo(
            pending_improvements=pending,
            exhausted=quota.remaining == 0 and pending == 0,
            remaining=quota.remaining,
            total=quota.total,
            next_reset_at=quota.next_reset_at,
            bonus_claimed=quota.bonus_claimed,
            email_verified=quota.email_verified,
            email=quota.email,
            verification_pending=bool(
                quota.challenge_digest
                and quota.challenge_expires_at
                and quota.challenge_expires_at > self.now()
                and quota.challenge_attempts < 5
            ),
            verification_resend_at=(
                quota.challenge_sent_at + timedelta(seconds=60) if quota.challenge_sent_at else None
            ),
            per_day_remaining=quota.remaining,
            per_day_total=quota.total,
            per_minute_remaining=settings.free_req_per_min,
            per_minute_total=settings.free_req_per_min,
        )

    async def status(self, installation_id: str) -> RateLimitInfo:
        quota = await self.locked(installation_id)
        result = await self.info(quota)
        await self.db.commit()
        return result

    async def reserve(self, installation_id: str) -> tuple[str | None, RateLimitInfo]:
        quota = await self.locked(installation_id)
        reservation_id = None
        if quota.remaining > 0:
            reservation_id = str(uuid.uuid4())
            quota.remaining -= 1
            # Bound recovery after worker failure; exceeds the configured maximum LLM work time.
            lease = max(300, settings.llm_request_timeout_seconds * settings.llm_max_retries + 120)
            self.db.add(
                QuotaReservation(
                    id=reservation_id,
                    installation_id=installation_id,
                    period_start=quota.period_start,
                    expires_at=self.now() + timedelta(seconds=lease),
                    status="pending",
                )
            )
        result = await self.info(quota)
        await self.db.commit()
        return reservation_id, result

    async def finish(self, reservation_id: str) -> RateLimitInfo:
        # Lookup is immutable; quota lock always precedes changing reservation state.
        reservation = await self.db.get(QuotaReservation, reservation_id)
        if reservation is None:
            raise HTTPException(409, "Quota reservation no longer exists")
        quota = await self.locked(reservation.installation_id)
        await self.db.refresh(reservation)
        if reservation.status != "pending" or reservation.expires_at <= self.now():
            raise HTTPException(409, "Quota reservation expired; please retry")
        reservation.status = "completed"
        await self.db.flush()
        # Caller commits result and consumption together.
        return await self.info(quota)

    async def refund(self, reservation_id: str | None) -> None:
        if reservation_id is None:
            return
        await self.db.rollback()
        reservation = await self.db.get(QuotaReservation, reservation_id)
        if reservation is None:
            return
        quota = await self.locked(reservation.installation_id)
        await self.db.refresh(reservation)
        if reservation.status == "pending":
            reservation.status = "refunded"
            if reservation.period_start == quota.period_start:
                quota.remaining += 1
        await self.db.commit()
