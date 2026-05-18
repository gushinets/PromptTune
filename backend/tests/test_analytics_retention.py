from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.analytics_retention import cleanup_analytics_events, retention_cutoff_utc


def test_retention_cutoff_utc_uses_13_month_policy_window():
    now = datetime(2026, 5, 15, 12, 0, tzinfo=UTC)
    cutoff = retention_cutoff_utc(now=now, retention_months=13)

    assert cutoff == datetime(2025, 4, 15, 12, 0, tzinfo=UTC)


def test_retention_cutoff_utc_honors_configured_months_exactly():
    now = datetime(2026, 3, 31, 12, 0, tzinfo=UTC)
    cutoff = retention_cutoff_utc(now=now, retention_months=1)

    assert cutoff == datetime(2026, 2, 28, 12, 0, tzinfo=UTC)


def test_retention_cutoff_utc_rejects_naive_datetime():
    now = datetime(2026, 3, 31, 12, 0)
    with pytest.raises(ValueError, match="timezone-aware"):
        retention_cutoff_utc(now=now, retention_months=1)


def test_retention_cutoff_utc_rejects_non_positive_months():
    now = datetime(2026, 3, 31, 12, 0, tzinfo=UTC)
    with pytest.raises(ValueError, match="must be positive"):
        retention_cutoff_utc(now=now, retention_months=0)


@pytest.mark.asyncio
async def test_cleanup_analytics_events_clamps_unknown_rowcount_to_zero():
    db = AsyncMock()
    db.execute = AsyncMock(return_value=SimpleNamespace(rowcount=-1))
    db.commit = AsyncMock(return_value=None)

    deleted = await cleanup_analytics_events(
        db,
        now=datetime(2026, 3, 31, 12, 0, tzinfo=UTC),
        retention_months=1,
    )

    assert deleted == 0
