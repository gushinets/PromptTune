import asyncio
import json
from unittest.mock import patch

import pytest

from app.dependencies import get_redis
from app.main import app
from app.services.rate_limiter import RateLimiter
from tests.test_rate_limiter import InMemoryRedisMock


async def run_request(receive, send):
    await app(
        {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.4"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/v1/improve",
            "raw_path": b"/v1/improve",
            "query_string": b"",
            "root_path": "",
            "headers": [(b"content-type", b"application/json")],
            "client": ("1.2.3.4", 1234),
            "server": ("test", 80),
        },
        receive,
        send,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel_server_task", [False, True])
async def test_cancellation_stops_llm_and_refunds_once(mock_db, cancel_server_task):
    redis = InMemoryRedisMock()
    await RateLimiter(redis).check("inst-1", "1.2.3.4")
    app.dependency_overrides[get_redis] = lambda: redis
    incoming = asyncio.Queue()
    incoming.put_nowait(
        {
            "type": "http.request",
            "body": json.dumps({"text": "write a poem", "installation_id": "inst-1"}).encode(),
            "more_body": False,
        }
    )
    started = asyncio.Event()
    stopped = asyncio.Event()
    messages = []

    async def generate(*args, **kwargs):
        started.set()
        try:
            await asyncio.Future()
        finally:
            stopped.set()

    async def send(message):
        messages.append(message)

    baseline = asyncio.all_tasks()
    try:
        with patch("app.services.prompt_service.improve_text", new=generate):
            task = asyncio.create_task(run_request(incoming.get, send))
            try:
                await asyncio.wait_for(started.wait(), timeout=1)
                if cancel_server_task:
                    task.cancel()
                    with pytest.raises(asyncio.CancelledError):
                        await task
                else:
                    incoming.put_nowait({"type": "http.disconnect"})
                    await asyncio.wait_for(asyncio.shield(task), timeout=1)
                assert stopped.is_set()
                counters = {
                    key: value for key, value in redis.store.items() if key.startswith("rl:")
                }
                assert len(counters) == 2
                assert set(counters.values()) == {"1"}
                assert mock_db.commit.await_count == 0
                await asyncio.sleep(0)
                assert not (asyncio.all_tasks() - baseline - {asyncio.current_task()})
            finally:
                if not task.done():
                    task.cancel()
                await asyncio.gather(task, return_exceptions=True)
    finally:
        app.dependency_overrides.pop(get_redis, None)


@pytest.mark.asyncio
async def test_success_keeps_quota_and_cleans_up_monitor(client, mock_db, mock_litellm):
    redis = InMemoryRedisMock()
    app.dependency_overrides[get_redis] = lambda: redis
    baseline = asyncio.all_tasks()
    try:
        response = await client.post(
            "/v1/improve", json={"text": "write a poem", "installation_id": "inst-1"}
        )
        assert response.status_code == 200
        counters = {key: value for key, value in redis.store.items() if key.startswith("rl:")}
        assert len(counters) == 2
        assert set(counters.values()) == {"1"}
        await asyncio.sleep(0)
        assert not (asyncio.all_tasks() - baseline - {asyncio.current_task()})
    finally:
        app.dependency_overrides.pop(get_redis, None)


@pytest.mark.asyncio
async def test_server_cancellation_during_reservation_refunds_the_charge(mock_db):
    charged = asyncio.Event()
    release = asyncio.Event()

    class PausedReservationRedis(InMemoryRedisMock):
        def pipeline(self):
            pipeline = super().pipeline()
            execute = pipeline.execute

            async def paused_execute():
                reserves = any(op == "incr" for op, _ in pipeline.ops)
                result = await execute()
                if reserves:
                    charged.set()
                    await release.wait()
                return result

            pipeline.execute = paused_execute
            return pipeline

    redis = PausedReservationRedis()
    app.dependency_overrides[get_redis] = lambda: redis
    incoming = asyncio.Queue()
    incoming.put_nowait(
        {
            "type": "http.request",
            "body": json.dumps({"text": "write a poem", "installation_id": "inst-1"}).encode(),
            "more_body": False,
        }
    )

    async def send(message):
        pass

    task = asyncio.create_task(run_request(incoming.get, send))
    try:
        await asyncio.wait_for(charged.wait(), timeout=1)
        task.cancel()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        counters = {key: value for key, value in redis.store.items() if key.startswith("rl:")}
        assert len(counters) == 2
        assert set(counters.values()) == {"0"}
        assert mock_db.commit.await_count == 0
    finally:
        release.set()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        app.dependency_overrides.pop(get_redis, None)
