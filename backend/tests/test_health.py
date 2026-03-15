import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_healthz(client: AsyncClient):
    response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_readyz(client: AsyncClient):
    response = await client.get("/readyz")
    assert response.status_code == 200
