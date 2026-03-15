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

    with patch("app.services.llm._request_completion", new=AsyncMock(return_value=mock_response)) as m:
        yield m


@pytest.fixture
def mock_redis():
    redis_mock = Mock()
    pipe_read = Mock()
    pipe_read.get = Mock()
    pipe_read.execute = AsyncMock(return_value=[0, 0, 0, 0])
    pipe_write = Mock()
    pipe_write.incr = Mock()
    pipe_write.expire = Mock()
    pipe_write.execute = AsyncMock(return_value=[None] * 8)
    redis_mock.pipeline = Mock(side_effect=[pipe_read, pipe_write])
    redis_mock.ping = AsyncMock(return_value=True)

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
