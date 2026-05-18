from datetime import datetime, timedelta, timezone

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import AnalyticsEvent


def retention_cutoff_utc(now: datetime | None = None, retention_months: int | None = None) -> datetime:
    current = now or datetime.now(timezone.utc)
    months = retention_months if retention_months is not None else settings.analytics_retention_months
    # 13 months retention (approx 395 days) keeps policy simple and explicit.
    return current - timedelta(days=months * 30 + 5)


async def cleanup_analytics_events(
    db: AsyncSession,
    now: datetime | None = None,
    retention_months: int | None = None,
) -> int:
    cutoff = retention_cutoff_utc(now=now, retention_months=retention_months)
    result = await db.execute(delete(AnalyticsEvent).where(AnalyticsEvent.occurred_at < cutoff))
    await db.commit()
    return int(result.rowcount or 0)
