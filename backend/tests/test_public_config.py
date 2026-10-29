import pytest
from httpx import AsyncClient

from app.config import settings


@pytest.mark.asyncio
async def test_config_exposes_runtime_input_limit(client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "prompt_input_max_chars", 30000)
    response = await client.get("/v1/config")
    assert response.status_code == 200
    assert response.json() == {"prompt_input_max_chars": 30000}
    monkeypatch.setattr(settings, "prompt_input_max_chars", 12345)
    assert (await client.get("/v1/config")).json() == {"prompt_input_max_chars": 12345}
