import pytest
from httpx import AsyncClient
from unittest.mock import AsyncMock, patch

from app.services.errors import UpstreamAuthError


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
    response = await client.post(
        "/v1/improve",
        json={
            "text": "",
            "installation_id": "test-inst-1",
        },
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_improve_returns_structured_upstream_auth_error(client: AsyncClient, mock_db, mock_redis):
    with patch(
        "app.services.prompt_service.improve_text",
        new=AsyncMock(side_effect=UpstreamAuthError("Server OpenAI API key is not configured")),
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
