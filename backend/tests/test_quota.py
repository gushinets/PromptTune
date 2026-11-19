"""Real PostgreSQL quota tests; set QUOTA_TEST_DATABASE_URL to a disposable database."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest


async def test_fifty_successes_and_refund(quota_sessions):
    from app.services.quota import QuotaService

    async with quota_sessions() as db:
        service = QuotaService(db)
        assert (await service.status("a")).remaining == 50
        for _ in range(50):
            reservation, info = await service.reserve("a")
            assert reservation
            await service.finish(reservation)
            await db.commit()
        assert (await service.status("a")).remaining == 0
        reservation, _ = await service.reserve("a")
        assert reservation is None
        # NAT neighbours receive independent quotas.
        reservation, _ = await service.reserve("b")
        await service.refund(reservation)
        await service.refund(reservation)
        assert (await service.status("b")).remaining == 50


async def test_concurrent_last_slot(quota_sessions):
    from app.services.quota import QuotaService

    async with quota_sessions() as db:
        for _ in range(49):
            reservation, _ = await QuotaService(db).reserve("last")
            await QuotaService(db).finish(reservation)
            await db.commit()

    async def reserve():
        async with quota_sessions() as db:
            return await QuotaService(db).reserve("last")

    results = await asyncio.gather(*[reserve() for _ in range(8)])
    assert sum(reservation is not None for reservation, _ in results) == 1


async def test_calendar_renewal_discards_balance_and_old_refunds(quota_sessions):
    from app.services.quota import QuotaService

    clock = [datetime(2028, 1, 31, 10, tzinfo=UTC)]
    async with quota_sessions() as db:
        service = QuotaService(db, now=lambda: clock[0])
        info = await service.status("calendar")
        assert info.next_reset_at == datetime(2028, 2, 28, 21, tzinfo=UTC)
        reservation, _ = await service.reserve("calendar")
        clock[0] = datetime(2028, 2, 28, 21, tzinfo=UTC)
        info = await service.status("calendar")
        assert info.remaining == 50
        assert info.next_reset_at == datetime(2028, 3, 30, 21, tzinfo=UTC)
        await service.refund(reservation)
        assert (await service.status("calendar")).remaining == 50
        clock[0] = datetime(2029, 2, 28, 21, tzinfo=UTC)
        assert (await service.status("calendar")).next_reset_at == datetime(
            2029, 3, 30, 21, tzinfo=UTC
        )


async def test_crashed_reservation_recovered_and_late_success_rejected(quota_sessions):
    from fastapi import HTTPException

    from app.services.quota import QuotaService

    clock = [datetime(2028, 1, 1, tzinfo=UTC)]
    async with quota_sessions() as db:
        service = QuotaService(db, now=lambda: clock[0])
        reservation, _ = await service.reserve("crash")
        clock[0] += timedelta(hours=1)
        assert (await service.status("crash")).remaining == 50
        with pytest.raises(HTTPException):
            await service.finish(reservation)
        await db.rollback()


async def test_api_success_exhaustion_and_provider_error_use_durable_quota(
    client,
    quota_sessions,
    mock_litellm,
    mock_redis,
):
    from unittest.mock import AsyncMock, patch

    from app.dependencies import get_db
    from app.main import app
    from app.services.errors import UpstreamBadResponseError
    from app.services.quota import QuotaService

    async def database():
        async with quota_sessions() as db:
            yield db

    app.dependency_overrides[get_db] = database
    payload = {"installation_id": "api", "text": "Improve this"}
    with patch(
        "app.services.prompt_service.improve_text",
        new=AsyncMock(side_effect=UpstreamBadResponseError("bad completion")),
    ):
        assert (await client.post("/v1/improve", json=payload)).status_code == 502
    assert (await client.get("/v1/limits", params={"installation_id": "api"})).json()[
        "remaining"
    ] == 50
    async with quota_sessions() as db:
        for _ in range(49):
            reservation, _ = await QuotaService(db).reserve("api")
            await QuotaService(db).finish(reservation)
            await db.commit()
    result = await client.post("/v1/improve", json=payload)
    assert result.status_code == 200
    assert result.json()["rate_limit"]["remaining"] == 0
    exhausted = await client.post("/v1/improve", json=payload)
    assert exhausted.status_code == 429
    assert "Monthly improvement quota exhausted" in exhausted.text


async def test_generation_releases_database_connection_while_waiting(quota_sessions, mock_redis):
    from unittest.mock import patch

    from app.services.errors import UpstreamBadResponseError
    from app.services.prompt_service import PromptService

    async with quota_sessions() as db:
        service = PromptService(db, mock_redis)
        await service.check_rate_limit("slow", "127.0.0.1")

        async def generate(*args, **kwargs):
            assert not db.in_transaction(), "LLM wait must not hold a database transaction"
            raise UpstreamBadResponseError("provider error")

        with (
            patch("app.services.prompt_service.improve_text", new=generate),
            pytest.raises(UpstreamBadResponseError),
        ):
            await service.improve_prompt("prompt", "slow")


async def test_installation_registration_keeps_original_clock_before_first_quota(quota_sessions):
    from app.services.quota import QuotaService

    clock = [datetime(2028, 1, 5, 10, tzinfo=UTC)]
    installed_at = clock[0]
    async with quota_sessions() as db:
        service = QuotaService(db, now=lambda: clock[0])
        # Offline delivery is retried on the 20th with the original installation timestamp.
        clock[0] = datetime(2028, 1, 20, tzinfo=UTC)
        await service.register("installed", installed_at)
        # Repeated registration must not move the installation anniversary.
        await service.register("installed", clock[0])
        info = await service.status("installed")
        assert info.next_reset_at == datetime(2028, 2, 4, 21, tzinfo=UTC)
        clock[0] = datetime(2028, 2, 4, 21, tzinfo=UTC)
        assert (await service.status("installed")).next_reset_at == datetime(
            2028, 3, 4, 21, tzinfo=UTC
        )


async def test_zero_held_by_pending_work_is_not_successfully_exhausted(quota_sessions):
    from app.services.quota import QuotaService

    async with quota_sessions() as db:
        service = QuotaService(db)
        for _ in range(48):
            reservation, _ = await service.reserve("parallel")
            await service.finish(reservation)
            await db.commit()
        first, _ = await service.reserve("parallel")
        second, held = await service.reserve("parallel")
        assert held.remaining == 0 and held.pending_improvements == 2 and not held.exhausted
        success49 = await service.finish(first)
        await db.commit()
        assert success49.remaining == 0 and success49.pending_improvements == 1
        assert not success49.exhausted
        denied, held = await service.reserve("parallel")
        assert denied is None and not held.exhausted
        await service.refund(second)
        available = await service.status("parallel")
        assert available.remaining == 1 and available.pending_improvements == 0
        last, _ = await service.reserve("parallel")
        success50 = await service.finish(last)
        await db.commit()
        assert success50.remaining == 0 and success50.pending_improvements == 0
        assert success50.exhausted


async def test_registration_endpoint_sets_clock_and_pending_requests_have_a_distinct_error(
    client,
    quota_sessions,
    mock_redis,
):
    from app.dependencies import get_db
    from app.main import app
    from app.services.quota import QuotaService, period_boundary

    async def database():
        async with quota_sessions() as db:
            yield db

    app.dependency_overrides[get_db] = database
    installed_at = datetime.now(UTC) - timedelta(days=15)
    registered = await client.post(
        "/v1/installations",
        json={"installation_id": "api-install", "installed_at": installed_at.isoformat()},
    )
    assert registered.status_code == 200
    status = (await client.get("/v1/limits", params={"installation_id": "api-install"})).json()
    assert datetime.fromisoformat(
        status["next_reset_at"].replace("Z", "+00:00")
    ) == period_boundary(installed_at, 1)
    async with quota_sessions() as db:
        for _ in range(50):
            await QuotaService(db).reserve("api-install")
    rejected = await client.post(
        "/v1/improve", json={"installation_id": "api-install", "text": "Improve"}
    )
    assert rejected.status_code == 429
    assert "temporarily reserved by pending requests" in rejected.json()["detail"]
