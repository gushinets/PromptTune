from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError

from app.api.v1.analytics import _validate_event_payload
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

    assert response.status_code == 200
    payload = response.json()
    assert payload["accepted"] == 0
    assert payload["deduplicated"] == 0
    assert len(payload["rejected"]) == 1
    assert "session_id is required" in payload["rejected"][0]["reason"]


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

    assert response.status_code == 200
    payload = response.json()
    assert payload["accepted"] == 0
    assert payload["deduplicated"] == 0
    assert len(payload["rejected"]) == 1
    assert "forbidden analytics properties" in payload["rejected"][0]["reason"]


@pytest.mark.asyncio
async def test_events_ingest_rejects_nested_forbidden_properties(
    client: AsyncClient, mock_db, mock_redis
):
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
                    "properties": {"meta": {"prompt": "raw prompt text"}},
                }
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["accepted"] == 0
    assert payload["deduplicated"] == 0
    assert len(payload["rejected"]) == 1
    assert "forbidden analytics properties" in payload["rejected"][0]["reason"]


@pytest.mark.asyncio
async def test_events_ingest_rejects_case_variant_forbidden_properties(
    client: AsyncClient, mock_db, mock_redis
):
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
                    "properties": {"Prompt": "raw prompt text", "meta": {"URL": "https://x.com"}},
                }
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["accepted"] == 0
    assert payload["deduplicated"] == 0
    assert len(payload["rejected"]) == 1
    assert "forbidden analytics properties" in payload["rejected"][0]["reason"]


@pytest.mark.asyncio
async def test_events_ingest_handles_deep_nested_properties_without_500(
    client: AsyncClient, mock_db, mock_redis
):
    deep: dict[str, object] = {}
    current = deep
    for _ in range(300):
        child: dict[str, object] = {}
        current["nested"] = child
        current = child
    current["Prompt"] = "raw prompt text"

    response = await client.post(
        "/v1/events",
        json={
            "events": [
                {
                    "event_id": "evt-deep-1",
                    "name": "prompt_submitted",
                    "user_id": "inst-1",
                    "session_id": "sess-1",
                    "occurred_at": datetime.now(UTC).isoformat(),
                    "source": "content",
                    "properties": deep,
                }
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["accepted"] == 0
    assert payload["deduplicated"] == 0
    assert len(payload["rejected"]) == 1
    assert "forbidden analytics properties" in payload["rejected"][0]["reason"]


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
async def test_events_ingest_rejects_forms_import_without_installation_id(
    client: AsyncClient, mock_db, mock_redis
):
    response = await client.post(
        "/v1/events",
        json={
            "events": [
                {
                    "event_id": "evt-forms-missing-inst-1",
                    "name": "uninstall_reason_submitted",
                    "user_id": " ",
                    "session_id": None,
                    "occurred_at": datetime.now(UTC).isoformat(),
                    "source": "forms_import",
                    "properties": {"reason": "too_many_bugs"},
                }
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["accepted"] == 0
    assert payload["deduplicated"] == 0
    assert len(payload["rejected"]) == 1
    assert payload["rejected"][0]["event_id"] == "evt-forms-missing-inst-1"
    assert payload["rejected"][0]["reason"] == "Your login is invalid"


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

    assert response.status_code == 200
    payload = response.json()
    assert payload["accepted"] == 0
    assert payload["deduplicated"] == 0
    assert len(payload["rejected"]) == 1
    assert "too large" in payload["rejected"][0]["reason"]


@pytest.mark.asyncio
async def test_events_ingest_keeps_valid_events_when_batch_contains_invalid(
    client: AsyncClient, mock_db, mock_redis
):
    response = await client.post(
        "/v1/events",
        json={
            "events": [
                {
                    "event_id": "evt-good-1",
                    "name": "popup_opened",
                    "user_id": "inst-1",
                    "session_id": "sess-1",
                    "occurred_at": datetime.now(UTC).isoformat(),
                    "source": "popup",
                    "properties": {},
                },
                {
                    "event_id": "evt-bad-1",
                    "name": "popup_opened",
                    "user_id": "inst-1",
                    "occurred_at": datetime.now(UTC).isoformat(),
                    "source": "popup",
                    "properties": {},
                },
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["accepted"] == 1
    assert payload["deduplicated"] == 0
    assert len(payload["rejected"]) == 1
    assert payload["rejected"][0]["event_id"] == "evt-bad-1"


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


def test_validate_event_payload_rejects_invalid_json_properties():
    circular: dict[str, object] = {}
    circular["self"] = circular

    with pytest.raises(HTTPException) as exc:
        _validate_event_payload(circular)

    assert exc.value.status_code == 422
    assert exc.value.detail == "analytics properties invalid"


@pytest.mark.asyncio
async def test_events_ingest_does_not_count_accepted_on_savepoint_integrity_error(
    client: AsyncClient, mock_db, mock_redis
):
    class _FailingBeginNested:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            raise IntegrityError("insert", {}, Exception("duplicate key"))

    mock_db.begin_nested = Mock(return_value=_FailingBeginNested())
    mock_db.get = AsyncMock(return_value=None)

    response = await client.post(
        "/v1/events",
        json={
            "events": [
                {
                    "event_id": "evt-dup-1",
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

    assert response.status_code == 200
    assert response.json() == {"accepted": 0, "deduplicated": 1, "rejected": []}
