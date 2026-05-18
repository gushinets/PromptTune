from datetime import UTC, datetime

from app.services.analytics_retention import retention_cutoff_utc


def test_retention_cutoff_utc_uses_13_month_policy_window():
    now = datetime(2026, 5, 15, 12, 0, tzinfo=UTC)
    cutoff = retention_cutoff_utc(now=now, retention_months=13)

    assert cutoff == datetime(2025, 4, 15, 12, 0, tzinfo=UTC)


def test_retention_cutoff_utc_honors_configured_months_exactly():
    now = datetime(2026, 3, 31, 12, 0, tzinfo=UTC)
    cutoff = retention_cutoff_utc(now=now, retention_months=1)

    assert cutoff == datetime(2026, 2, 28, 12, 0, tzinfo=UTC)
