import os
from collections.abc import AsyncGenerator
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.models import Base
from app.dependencies import get_db, get_redis
from app.main import app


class _AsyncNullContext:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient]:
    app.dependency_overrides.clear()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
def mock_litellm():
    mock_response = SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    content=(
                        '{"improved_text":"better result","changes":'
                        '["Added concrete output requirements","Clarified the response structure"]}'
                    )
                )
            )
        ],
        model="gpt-4o-mini",
        usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5, total_tokens=15),
        id="chatcmpl-test",
        _hidden_params={"custom_llm_provider": "openrouter"},
    )

    with (
        patch("app.services.llm._resolve_provider_api_key", return_value="sk-test"),
        patch("app.services.llm.acompletion", new=AsyncMock(return_value=mock_response)) as m,
    ):
        yield m


@pytest.fixture
def mock_redis():
    redis_mock = Mock()
    # resolve_bucket uses redis.get, redis.set, redis.expire directly (all async)
    redis_mock.get = AsyncMock(return_value=None)  # no existing bucket → new UUID
    redis_mock.set = AsyncMock(return_value=True)
    redis_mock.expire = AsyncMock(return_value=True)
    redis_mock.incr = AsyncMock(return_value=1)
    # check() uses redis.mget to read counters (0 usage → allowed)
    redis_mock.mget = AsyncMock(return_value=[None, None])
    redis_mock.ping = AsyncMock(return_value=True)
    redis_mock.eval = AsyncMock(return_value=1)

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
    session.begin_nested = Mock(return_value=_AsyncNullContext())

    async def override_get_db():
        yield session

    app.dependency_overrides[get_db] = override_get_db
    from app.api.schemas import RateLimitInfo

    info = RateLimitInfo(
        remaining=49,
        total=50,
        per_day_remaining=49,
        per_day_total=50,
        per_minute_remaining=9,
        per_minute_total=10,
    )
    with (
        patch(
            "app.services.quota.QuotaService.reserve",
            new=AsyncMock(return_value=("reservation", info)),
        ) as reserve,
        patch("app.services.quota.QuotaService.finish", new=AsyncMock(return_value=info)) as finish,
        patch("app.services.quota.QuotaService.refund", new=AsyncMock()) as refund,
        patch("app.services.quota.QuotaService.status", new=AsyncMock(return_value=info)),
    ):
        session.quota_reserve = reserve
        session.quota_finish = finish
        session.quota_refund = refund
        yield session
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def quota_sessions():
    url = os.getenv("QUOTA_TEST_DATABASE_URL")
    if not url:
        pytest.skip("QUOTA_TEST_DATABASE_URL is required for PostgreSQL integration tests")
    engine = create_async_engine(url)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()
