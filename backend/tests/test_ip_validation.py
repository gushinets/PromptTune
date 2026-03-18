"""Tests for IP validation: 403 when IP present but no valid installation_id."""

import pytest
from httpx import AsyncClient

from app.dependencies import get_client_ip


@pytest.mark.asyncio
async def test_improve_returns_403_when_ip_present_and_installation_id_empty(
    client: AsyncClient, mock_db, mock_redis
):
    """Vulnerability check: request with IP but empty installation_id is rejected with 403."""
    response = await client.post(
        "/v1/improve",
        headers={"X-Forwarded-For": "192.168.1.1"},
        json={
            "text": "write me a poem",
            "installation_id": "",
            "client": "manual-test",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Your login is invalid"


@pytest.mark.asyncio
async def test_limits_returns_403_when_ip_present_and_installation_id_empty(
    client: AsyncClient, mock_redis
):
    """Vulnerability check: GET limits with IP but empty installation_id is rejected with 403."""
    response = await client.get(
        "/v1/limits",
        headers={"X-Forwarded-For": "10.0.0.1"},
        params={"installation_id": ""},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Your login is invalid"


@pytest.mark.asyncio
async def test_prompts_returns_403_when_ip_present_and_installation_id_empty(
    client: AsyncClient, mock_db
):
    """Vulnerability check: save prompt with IP but empty installation_id is rejected with 403."""
    response = await client.post(
        "/v1/prompts",
        headers={"X-Forwarded-For": "172.16.0.1"},
        json={
            "installation_id": "",
            "client": "manual-test",
            "original_text": "original",
            "improved_text": "improved",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Your login is invalid"


@pytest.mark.asyncio
async def test_no_403_when_ip_unknown_and_installation_id_empty(
    client: AsyncClient, mock_db, mock_redis
):
    """When client IP is unknown, empty installation_id does not trigger 403 (422 or normal flow)."""

    async def unknown_ip(_):
        return "unknown"

    from app.main import app

    app.dependency_overrides[get_client_ip] = unknown_ip

    try:
        response = await client.post(
            "/v1/improve",
            json={
                "text": "write me a poem",
                "installation_id": "",
                "client": "manual-test",
            },
        )
        # With unknown IP we do not raise 403; request may proceed and fail elsewhere (e.g. 429/200) or 422
        assert response.status_code != 403
    finally:
        app.dependency_overrides.pop(get_client_ip, None)
