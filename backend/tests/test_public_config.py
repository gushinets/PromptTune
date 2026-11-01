import pytest
from httpx import AsyncClient

from app.config import BotConfig, settings


@pytest.mark.asyncio
async def test_config_exposes_runtime_input_limit(client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "prompt_input_max_chars", 30000)
    response = await client.get("/v1/config")
    assert response.status_code == 200
    assert response.json() == {"prompt_input_max_chars": 30000}
    monkeypatch.setattr(settings, "prompt_input_max_chars", 12345)
    assert (await client.get("/v1/config")).json() == {"prompt_input_max_chars": 12345}


@pytest.mark.asyncio
@pytest.mark.parametrize("length, status", [(30000, 200), (30001, 422)])
async def test_default_limit_matches_improve_acceptance_boundary(
    client: AsyncClient, monkeypatch, mock_litellm, mock_db, mock_redis, length, status
):
    monkeypatch.delenv("PROMPT_INPUT_MAX_CHARS", raising=False)
    monkeypatch.setattr(
        settings, "prompt_input_max_chars", BotConfig.from_env().prompt_input_max_chars
    )
    assert (await client.get("/v1/config")).json() == {"prompt_input_max_chars": 30000}
    response = await client.post(
        "/v1/improve",
        json={"text": "x" * length, "installation_id": "test-inst-1", "client": "extension"},
    )
    assert response.status_code == status
