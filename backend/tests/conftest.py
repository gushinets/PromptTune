from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
def mock_litellm():
    mock_response = AsyncMock()
    mock_response.choices = [AsyncMock()]
    mock_response.choices[0].message.content = "improved prompt text"
    mock_response.model = "gpt-4o-mini"

    with patch("app.services.llm.litellm.acompletion", return_value=mock_response) as m:
        yield m


@pytest.fixture
def mock_redis():
    redis_mock = AsyncMock()
    pipe_mock = AsyncMock()
    pipe_mock.execute = AsyncMock(return_value=[0, 0, 0, 0])
    redis_mock.pipeline.return_value = pipe_mock

    with patch("app.dependencies.get_redis", return_value=redis_mock):
        yield redis_mock
