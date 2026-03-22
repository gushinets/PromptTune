from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, Mock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.dependencies import get_db, get_redis
from app.main import app


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient]:
    app.dependency_overrides.clear()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
def mock_litellm():
    mock_response = {
        "choices": [{"message": {"content": "better result"}}],
        "model": "gpt-4o-mini",
    }

    with patch(
        "app.services.llm._request_completion", new=AsyncMock(return_value=mock_response)
    ) as m:
        yield m


@pytest.fixture
def mock_redis():
    redis_mock = Mock()
    # resolve_bucket uses redis.get, redis.set, redis.expire directly (all async)
    redis_mock.get = AsyncMock(return_value=None)  # no existing bucket → new UUID
    redis_mock.set = AsyncMock(return_value=True)
    redis_mock.expire = AsyncMock(return_value=True)
    # check() uses redis.mget to read counters (0 usage → allowed)
    redis_mock.mget = AsyncMock(return_value=[None, None])
    redis_mock.ping = AsyncMock(return_value=True)

    # Pipeline mock works for both get_remaining (GETs) and check (incr/expire)
    pipe_mock = Mock()
    pipe_mock.get = Mock()
    pipe_mock.incr = Mock()
    pipe_mock.expire = Mock()
    pipe_mock.execute = AsyncMock(return_value=[1, True, 1, True])
    redis_mock.pipeline = Mock(return_value=pipe_mock)

    async def override_get_redis():
        return redis_mock

    app.dependency_overrides[get_redis] = override_get_redis
    yield redis_mock
    app.dependency_overrides.pop(get_redis, None)


@pytest.fixture
def mock_db():
    session = AsyncMock()
    session.add = Mock()
    session.get = AsyncMock(return_value=None)
    session.flush = AsyncMock(return_value=None)
    session.commit = AsyncMock(return_value=None)

    async def override_get_db():
        yield session

    app.dependency_overrides[get_db] = override_get_db
    yield session
    app.dependency_overrides.pop(get_db, None)
