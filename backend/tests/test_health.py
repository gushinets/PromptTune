from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_healthz(client: AsyncClient):
    response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_readyz(client: AsyncClient, mock_redis, mock_db, monkeypatch):
    class _FakeSessionCtx:
        async def __aenter__(self):
            return mock_db

        async def __aexit__(self, exc_type, exc, tb):
            return False

    from app.api.v1 import health as health_module

    monkeypatch.setattr(health_module, "async_session_factory", lambda: _FakeSessionCtx())

    response = await client.get("/readyz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_readyz_reports_missing_provider_key(client: AsyncClient, mock_redis, monkeypatch):
    from app.api.v1 import health as health_module

    class _FakeSessionCtx:
        async def __aenter__(self):
            return AsyncMock()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(health_module, "async_session_factory", lambda: _FakeSessionCtx())
    monkeypatch.setattr(health_module.settings, "llm_backend", "OPENAI")
    monkeypatch.setattr(health_module.settings, "openai_api_key", None)

    response = await client.get("/readyz")

    assert response.status_code == 503
    assert response.json()["detail"] == "OPENAI_API_KEY is required when LLM_BACKEND=OPENAI"
