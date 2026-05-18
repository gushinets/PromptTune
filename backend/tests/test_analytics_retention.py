from datetime import UTC, datetime

from app.services.analytics_retention import retention_cutoff_utc


def test_retention_cutoff_utc_uses_13_month_policy_window():
    now = datetime(2026, 5, 15, 12, 0, tzinfo=UTC)
    cutoff = retention_cutoff_utc(now=now, retention_months=13)

    # 13*30+5 days
    assert (now - cutoff).days == 395
