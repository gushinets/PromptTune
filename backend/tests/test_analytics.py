from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock

import pytest
from httpx import AsyncClient

from app.config import settings


@pytest.mark.asyncio
async def test_events_ingest_accepts_valid_batch(client: AsyncClient, mock_db, mock_redis):
    response = await client.post(
        "/v1/events",
        json={
            "events": [
                {
                    "event_id": "evt-1",
                    "name": "popup_opened",
                    "user_id": "inst-1",
                    "session_id": "sess-1",
                    "occurred_at": datetime.now(UTC).isoformat(),
                    "extension_version": "1.0.0",
                    "os": "mac",
                    "chrome_version": "136",
                    "user_plan": "free",
                    "source": "popup",
                    "properties": {"site_hostname": "example.com"},
                }
            ]
        },
    )

    assert response.status_code == 200
    assert response.json() == {"accepted": 1, "deduplicated": 0, "rejected": []}
    mock_db.add.assert_called_once()
    mock_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_events_ingest_deduplicates_by_event_id(client: AsyncClient, mock_db, mock_redis):
    mock_db.get = AsyncMock(side_effect=[None, Mock()])

    response = await client.post(
        "/v1/events",
        json={
            "events": [
                {
                    "event_id": "evt-1",
                    "name": "popup_opened",
                    "user_id": "inst-1",
                    "session_id": "sess-1",
                    "occurred_at": datetime.now(UTC).isoformat(),
                    "source": "popup",
                    "properties": {},
                },
                {
                    "event_id": "evt-1",
                    "name": "popup_opened",
                    "user_id": "inst-1",
                    "session_id": "sess-1",
                    "occurred_at": datetime.now(UTC).isoformat(),
                    "source": "popup",
                    "properties": {},
                },
            ]
        },
    )

    assert response.status_code == 200
    assert response.json() == {"accepted": 1, "deduplicated": 1, "rejected": []}


@pytest.mark.asyncio
async def test_events_ingest_requires_session_for_extension_sources(
    client: AsyncClient, mock_db, mock_redis
):
    response = await client.post(
        "/v1/events",
        json={
            "events": [
                {
                    "event_id": "evt-1",
                    "name": "popup_opened",
                    "user_id": "inst-1",
                    "occurred_at": datetime.now(UTC).isoformat(),
                    "source": "popup",
                    "properties": {},
                }
            ]
        },
    )

    assert response.status_code == 422
    assert "session_id is required" in response.json()["detail"]


@pytest.mark.asyncio
async def test_events_ingest_rejects_forbidden_properties(client: AsyncClient, mock_db, mock_redis):
    response = await client.post(
        "/v1/events",
        json={
            "events": [
                {
                    "event_id": "evt-1",
                    "name": "prompt_submitted",
                    "user_id": "inst-1",
                    "session_id": "sess-1",
                    "occurred_at": datetime.now(UTC).isoformat(),
                    "source": "content",
                    "properties": {"prompt": "raw prompt text"},
                }
            ]
        },
    )

    assert response.status_code == 422
    assert "forbidden analytics properties" in response.json()["detail"]


@pytest.mark.asyncio
async def test_events_ingest_accepts_all_13_event_names(client: AsyncClient, mock_db, mock_redis):
    names = [
        "extension_installed",
        "onboarding_completed",
        "onboarding_abandoned",
        "first_prompt_submitted",
        "first_result_copied",
        "popup_opened",
        "prompt_submitted",
        "result_displayed",
        "result_copied",
        "result_regenerated",
        "api_error",
        "extension_disabled",
        "uninstall_reason_submitted",
    ]

    events = [
        {
            "event_id": f"evt-{i}",
            "name": name,
            "user_id": "inst-1",
            "session_id": None,
            "occurred_at": datetime.now(UTC).isoformat(),
            "source": "forms_import",
            "properties": {},
        }
        for i, name in enumerate(names, start=1)
    ]

    response = await client.post("/v1/events", json={"events": events})

    assert response.status_code == 200
    assert response.json() == {"accepted": 13, "deduplicated": 0, "rejected": []}


@pytest.mark.asyncio
async def test_events_ingest_rejects_unknown_event_name(client: AsyncClient, mock_db, mock_redis):
    response = await client.post(
        "/v1/events",
        json={
            "events": [
                {
                    "event_id": "evt-1",
                    "name": "unknown_event",
                    "user_id": "inst-1",
                    "session_id": "sess-1",
                    "occurred_at": datetime.now(UTC).isoformat(),
                    "source": "popup",
                    "properties": {},
                }
            ]
        },
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_events_ingest_allows_nullable_session_for_forms_import(
    client: AsyncClient, mock_db, mock_redis
):
    response = await client.post(
        "/v1/events",
        json={
            "events": [
                {
                    "event_id": "evt-forms-1",
                    "name": "uninstall_reason_submitted",
                    "user_id": "inst-forms-1",
                    "session_id": None,
                    "occurred_at": datetime.now(UTC).isoformat(),
                    "source": "forms_import",
                    "properties": {"reason": "too_many_bugs"},
                }
            ]
        },
    )

    assert response.status_code == 200
    assert response.json() == {"accepted": 1, "deduplicated": 0, "rejected": []}


@pytest.mark.asyncio
async def test_events_ingest_rejects_oversized_properties(client: AsyncClient, mock_db, mock_redis):
    response = await client.post(
        "/v1/events",
        json={
            "events": [
                {
                    "event_id": "evt-big-1",
                    "name": "popup_opened",
                    "user_id": "inst-1",
                    "session_id": "sess-1",
                    "occurred_at": datetime.now(UTC).isoformat(),
                    "source": "popup",
                    "properties": {"blob": "x" * 9000},
                }
            ]
        },
    )

    assert response.status_code == 422
    assert "too large" in response.json()["detail"]


@pytest.mark.asyncio
async def test_events_ingest_returns_503_when_analytics_disabled(
    client: AsyncClient, mock_db, mock_redis
):
    previous = settings.analytics_enabled
    settings.analytics_enabled = False
    try:
        response = await client.post(
            "/v1/events",
            json={
                "events": [
                    {
                        "event_id": "evt-1",
                        "name": "popup_opened",
                        "user_id": "inst-1",
                        "session_id": "sess-1",
                        "occurred_at": datetime.now(UTC).isoformat(),
                        "source": "popup",
                        "properties": {},
                    }
                ]
            },
        )
    finally:
        settings.analytics_enabled = previous

    assert response.status_code == 503
