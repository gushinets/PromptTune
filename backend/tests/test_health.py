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
    if health_module.settings.llm_backend == "OPENROUTER":
        monkeypatch.setattr(health_module.settings, "openrouter_api_key", "sk-test-placeholder")
    else:
        monkeypatch.setattr(health_module.settings, "openai_api_key", "sk-test-placeholder")

    response = await client.get("/readyz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_readyz_db_failure(client: AsyncClient, mock_redis, monkeypatch):
    from app.api.v1 import health as health_module

    def _failing_session_factory():
        raise Exception("DB connection failed")

    monkeypatch.setattr(health_module, "async_session_factory", _failing_session_factory)

    response = await client.get("/readyz")
    assert response.status_code == 503
    assert response.json()["detail"] == "DB not ready"


@pytest.mark.asyncio
async def test_readyz_redis_failure(client: AsyncClient, mock_db, monkeypatch):
    from app.api.v1 import health as health_module

    class _FakeSessionCtx:
        async def __aenter__(self):
            return mock_db

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(health_module, "async_session_factory", lambda: _FakeSessionCtx())

    # Override get_redis with a mock whose ping() raises
    failing_redis = AsyncMock()
    failing_redis.ping = AsyncMock(side_effect=Exception("Redis connection failed"))

    from app.dependencies import get_redis
    from app.main import app

    async def override_get_redis():
        return failing_redis

    app.dependency_overrides[get_redis] = override_get_redis

    try:
        response = await client.get("/readyz")
    finally:
        app.dependency_overrides.pop(get_redis, None)

    assert response.status_code == 503
    assert response.json()["detail"] == "Redis not ready"
