import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_improve_requires_authorization(client: AsyncClient, mock_db, mock_redis):
    response = await client.post(
        "/v1/improve",
        json={
            "text": "write me a poem",
            "installation_id": "test-inst-1",
            "client": "manual-test",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing Authorization header"


@pytest.mark.asyncio
async def test_improve_accepts_raw_authorization_header(
    client: AsyncClient, mock_litellm, mock_db, mock_redis
):
    response = await client.post(
        "/v1/improve",
        headers={"Authorization": "sk-or-v1-test"},
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
async def test_improve_accepts_bearer_authorization_header(
    client: AsyncClient, mock_litellm, mock_db, mock_redis
):
    response = await client.post(
        "/v1/improve",
        headers={"Authorization": "Bearer sk-or-v1-test"},
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
        headers={"Authorization": "sk-or-v1-test"},
        json={
            "text": "",
            "installation_id": "test-inst-1",
        },
    )

    assert response.status_code == 422
