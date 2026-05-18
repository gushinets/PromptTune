from datetime import UTC, datetime

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import AnalyticsEvent


def _days_in_month(year: int, month: int) -> int:
    if month == 2:
        is_leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
        return 29 if is_leap else 28
    if month in {4, 6, 9, 11}:
        return 30
    return 31


def _subtract_calendar_months(value: datetime, months: int) -> datetime:
    month_index = value.month - months
    year = value.year + (month_index - 1) // 12
    month = (month_index - 1) % 12 + 1
    day = min(value.day, _days_in_month(year, month))
    return value.replace(year=year, month=month, day=day)


def retention_cutoff_utc(
    now: datetime | None = None, retention_months: int | None = None
) -> datetime:
    current = now or datetime.now(UTC)
    if current.tzinfo is None or current.utcoffset() is None:
        raise ValueError("now must be timezone-aware")

    months = (
        retention_months if retention_months is not None else settings.analytics_retention_months
    )
    if months <= 0:
        raise ValueError("retention_months must be positive")

    return _subtract_calendar_months(current, months)


async def cleanup_analytics_events(
    db: AsyncSession,
    now: datetime | None = None,
    retention_months: int | None = None,
) -> int:
    cutoff = retention_cutoff_utc(now=now, retention_months=retention_months)
    result = await db.execute(delete(AnalyticsEvent).where(AnalyticsEvent.occurred_at < cutoff))
    await db.commit()
    return max(int(result.rowcount or 0), 0)
