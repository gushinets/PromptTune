from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.config import settings
from app.services.errors import UpstreamAuthError, UpstreamBadResponseError


@pytest.mark.asyncio
async def test_improve_works_without_authorization_header(
    client: AsyncClient, mock_litellm, mock_db, mock_redis
):
    response = await client.post(
        "/v1/improve",
        json={
            "text": "write me a poem",
            "installation_id": "test-inst-1",
            "client": "manual-test",
            "client_version": "0.1.0",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["improved_text"] == "better result"
    assert body["rate_limit"]["per_minute_remaining"] == 9
    assert body["rate_limit"]["per_day_remaining"] == 49
    assert body["rate_limit"]["per_minute_total"] == 10
    assert body["rate_limit"]["per_day_total"] == 50


@pytest.mark.asyncio
async def test_improve_ignores_client_authorization_header(
    client: AsyncClient, mock_litellm, mock_db, mock_redis
):
    response = await client.post(
        "/v1/improve",
        headers={"Authorization": "sk-or-v1-client-should-not-matter"},
        json={
            "text": "write me a poem",
            "installation_id": "test-inst-1",
            "client": "manual-test",
        },
    )

    assert response.status_code == 200
    assert response.json()["improved_text"] == "better result"


@pytest.mark.asyncio
async def test_improve_validates_required_fields(client: AsyncClient, mock_db, mock_redis):
    """Test that missing required fields (installation_id, text) return 422."""
    response = await client.post(
        "/v1/improve",
        json={
            # Missing both required fields: text and installation_id
        },
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_improve_works_without_client_field(
    client: AsyncClient, mock_litellm, mock_db, mock_redis
):
    """Test backward compatibility: client field should be optional."""
    response = await client.post(
        "/v1/improve",
        json={
            "text": "write me a poem",
            "installation_id": "test-inst-1",
            "client_version": "0.1.0",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["improved_text"] == "better result"
    assert body["rate_limit"]["per_minute_remaining"] == 9
    assert body["rate_limit"]["per_day_remaining"] == 49


@pytest.mark.asyncio
async def test_improve_accepts_goal_and_passes_it_to_llm(
    client: AsyncClient, mock_litellm, mock_db, mock_redis
):
    response = await client.post(
        "/v1/improve",
        json={
            "text": "write me a poem",
            "goal": "clarity",
            "installation_id": "test-inst-1",
            "client": "manual-test",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["improved_text"] == "better result"
    assert len(mock_litellm.await_args.kwargs["messages"]) == 3
    assert mock_litellm.await_args.kwargs["messages"][1]["role"] == "system"
    assert "ясность" in mock_litellm.await_args.kwargs["messages"][1]["content"].lower()


@pytest.mark.asyncio
async def test_improve_returns_structured_upstream_auth_error(
    client: AsyncClient, mock_db, mock_redis
):
    with (
        patch(
            "app.services.prompt_service.improve_text",
            new=AsyncMock(side_effect=UpstreamAuthError("Server OpenAI API key is not configured")),
        ),
        patch("app.api.v1.improve.PromptService.refund_rate_limit", new=AsyncMock()) as refund_mock,
    ):
        response = await client.post(
            "/v1/improve",
            json={
                "text": "write me a poem",
                "installation_id": "test-inst-1",
                "client": "manual-test",
            },
        )

    assert response.status_code == 503
    assert response.json() == {
        "detail": "Server OpenAI API key is not configured",
        "error_code": "UPSTREAM_AUTH_ERROR",
    }
    refund_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_improve_refunds_quota_when_provider_returns_empty_completion(
    client: AsyncClient, mock_db, mock_redis
):
    with (
        patch(
            "app.services.prompt_service.improve_text",
            new=AsyncMock(
                side_effect=UpstreamBadResponseError("Provider returned empty completion")
            ),
        ),
        patch("app.api.v1.improve.PromptService.refund_rate_limit", new=AsyncMock()) as refund_mock,
    ):
        response = await client.post(
            "/v1/improve",
            headers={"X-Forwarded-For": "1.2.3.4"},
            json={
                "text": "write me a poem",
                "installation_id": "test-inst-1",
                "client": "manual-test",
            },
        )

    assert response.status_code == 502
    assert response.json() == {
        "detail": "Provider returned empty completion",
        "error_code": "UPSTREAM_BAD_RESPONSE",
    }
    refund_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_improve_does_not_refund_on_non_upstream_error(
    client: AsyncClient, mock_db, mock_redis
):
    with (
        patch(
            "app.services.prompt_service.improve_text",
            new=AsyncMock(side_effect=RuntimeError("boom")),
        ),
        patch(
            "app.api.v1.improve.PromptService.refund_rate_limit",
            new=AsyncMock(),
        ) as refund_mock,
        pytest.raises(RuntimeError),
    ):
        await client.post(
            "/v1/improve",
            headers={"X-Forwarded-For": "1.2.3.4"},
            json={
                "text": "write me a poem",
                "installation_id": "test-inst-1",
                "client": "manual-test",
            },
        )

    refund_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_improve_rejects_input_longer_than_configured_limit_without_charging_quota(
    client: AsyncClient, mock_db, mock_redis
):
    oversized = "x" * (settings.prompt_input_max_chars + 1)

    with patch("app.api.v1.improve.PromptService.check_rate_limit", new=AsyncMock()) as check_mock:
        response = await client.post(
            "/v1/improve",
            json={
                "text": oversized,
                "installation_id": "test-inst-1",
                "client": "manual-test",
            },
        )

    assert response.status_code == 422
    assert response.json() == {
        "detail": f"Input text exceeds maximum length of {settings.prompt_input_max_chars} characters."
    }
    check_mock.assert_not_awaited()
