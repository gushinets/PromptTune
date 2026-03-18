import pytest
from httpx import AsyncClient
from unittest.mock import AsyncMock, Mock

from app.main import app
from app.dependencies import get_redis


@pytest.mark.asyncio
async def test_limits_returns_remaining_without_incrementing(client: AsyncClient):
    redis_mock = Mock()
    pipe_mock = Mock()
    pipe_mock.get = Mock()
    pipe_mock.execute = AsyncMock(return_value=[1, 2, 1, 2])
    pipe_mock.incr = Mock()
    pipe_mock.expire = Mock()
    redis_mock.pipeline = Mock(return_value=pipe_mock)

    async def override_get_redis():
        return redis_mock

    app.dependency_overrides[get_redis] = override_get_redis
    response = await client.get("/v1/limits", params={"installation_id": "test-inst-1"})

    assert response.status_code == 200
    assert response.json() == {
        "per_minute_remaining": 9,
        "per_day_remaining": 48,
        "per_minute_total": 10,
        "per_day_total": 50,
    }
    pipe_mock.incr.assert_not_called()
    pipe_mock.expire.assert_not_called()
