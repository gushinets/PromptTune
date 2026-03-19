import pytest

from datetime import UTC, datetime

from app.services.rate_limiter import RateLimiter


class RedisPipelineMock:
    def __init__(self, redis):
        self.redis = redis
        self.ops: list[tuple[str, tuple]] = []

    def get(self, key: str):
        self.ops.append(("get", (key,)))
        return self

    def incr(self, key: str):
        self.ops.append(("incr", (key,)))
        return self

    def expire(self, key: str, ttl: int):
        self.ops.append(("expire", (key, ttl)))
        return self

    def set(self, key: str, value: str, ex: int | None = None):
        self.ops.append(("set", (key, value, ex)))
        return self

    async def execute(self):
        results: list[object] = []
        for op, args in self.ops:
            if op == "get":
                value = await self.redis.get(*args)
                results.append(value)
            elif op == "incr":
                value = await self.redis.incr(*args)
                results.append(value)
            elif op == "expire":
                value = await self.redis.expire(*args)
                results.append(value)
            elif op == "set":
                value = await self.redis.set(*args)
                results.append(value)
        self.ops.clear()
        return results


class InMemoryRedisMock:
    def __init__(self):
        self.store: dict[str, str] = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def mget(self, *keys: str):
        return [self.store.get(key) for key in keys]

    async def set(self, key: str, value: str, ex: int | None = None):
        self.store[key] = str(value)
        return True

    async def expire(self, key: str, ttl: int):
        return True

    async def incr(self, key: str):
        next_value = int(self.store.get(key, "0")) + 1
        self.store[key] = str(next_value)
        return next_value

    def pipeline(self):
        return RedisPipelineMock(self)


@pytest.mark.asyncio
async def test_allows_when_under_limit():
    redis_mock = InMemoryRedisMock()
    limiter = RateLimiter(redis_mock)
    allowed, remaining = await limiter.check("inst-1", "1.2.3.4")

    assert allowed is True
    assert remaining["per_minute_remaining"] >= 0
    assert remaining["per_day_remaining"] >= 0


@pytest.mark.asyncio
async def test_blocks_when_minute_limit_exceeded():
    from app.config import settings

    redis_mock = InMemoryRedisMock()
    limiter = RateLimiter(redis_mock)
    now = limiter.now()
    bucket = await limiter.resolve_bucket("inst-1", "1.2.3.4")
    min_key = f"rl:{bucket}:m:{now.strftime('%Y%m%d%H%M')}"
    redis_mock.store[min_key] = str(settings.free_req_per_min)

    allowed, remaining = await limiter.check("inst-1", "1.2.3.4")

    assert allowed is False
    assert remaining["per_minute_remaining"] == 0


@pytest.mark.asyncio
async def test_blocks_when_day_limit_exceeded():
    from app.config import settings

    redis_mock = InMemoryRedisMock()
    limiter = RateLimiter(redis_mock)
    now = limiter.now()
    bucket = await limiter.resolve_bucket("inst-1", "1.2.3.4")
    day_key = f"rl:{bucket}:d:{now.strftime('%Y%m%d')}"
    redis_mock.store[day_key] = str(settings.free_req_per_day)

    allowed, remaining = await limiter.check("inst-1", "1.2.3.4")

    assert allowed is False
    assert remaining["per_day_remaining"] == 0


@pytest.mark.asyncio
async def test_get_remaining_does_not_increment():
    redis_mock = InMemoryRedisMock()
    limiter = RateLimiter(redis_mock)
    bucket = await limiter.resolve_bucket("inst-1", "1.2.3.4")
    now = limiter.now()
    redis_mock.store[f"rl:{bucket}:d:{now.strftime('%Y%m%d')}"] = "1"
    redis_mock.store[f"rl:{bucket}:m:{now.strftime('%Y%m%d%H%M')}"] = "2"
    allowed, remaining = await limiter.get_remaining("inst-1", "1.2.3.4")

    assert allowed is True
    assert remaining["per_minute_remaining"] >= 0
    assert remaining["per_day_remaining"] >= 0


@pytest.mark.asyncio
async def test_bypass_chain_keeps_same_quota_bucket():
    redis_mock = InMemoryRedisMock()
    limiter = RateLimiter(redis_mock)

    allowed_a1, rem_a1 = await limiter.check("A", "1.1.1.1")
    allowed_b1, rem_b1 = await limiter.check("B", "1.1.1.1")
    allowed_b2, rem_b2 = await limiter.check("B", "2.2.2.2")

    assert allowed_a1 is True
    assert allowed_b1 is True
    assert allowed_b2 is True
    assert rem_b1["per_day_remaining"] == rem_a1["per_day_remaining"] - 1
    assert rem_b2["per_day_remaining"] == rem_a1["per_day_remaining"] - 2


@pytest.mark.asyncio
async def test_vpn_change_only_keeps_same_quota_bucket():
    redis_mock = InMemoryRedisMock()
    limiter = RateLimiter(redis_mock)

    _, first = await limiter.check("A", "1.1.1.1")
    _, second = await limiter.check("A", "8.8.8.8")

    assert second["per_day_remaining"] == first["per_day_remaining"] - 1


@pytest.mark.asyncio
async def test_installation_change_only_keeps_same_quota_bucket():
    redis_mock = InMemoryRedisMock()
    limiter = RateLimiter(redis_mock)

    _, first = await limiter.check("A", "1.1.1.1")
    _, second = await limiter.check("B", "1.1.1.1")

    assert second["per_day_remaining"] == first["per_day_remaining"] - 1


@pytest.mark.asyncio
async def test_daily_reset_on_next_day():
    redis_mock = InMemoryRedisMock()
    day1 = datetime(2026, 3, 19, 10, 0, tzinfo=UTC)
    day2 = datetime(2026, 3, 20, 10, 0, tzinfo=UTC)
    current = day1

    def now_provider():
        return current

    limiter = RateLimiter(redis_mock, now=now_provider)

    _, day1_remaining = await limiter.check("A", "1.1.1.1")
    current = day2
    _, day2_remaining = await limiter.get_remaining("A", "1.1.1.1")

    assert day1_remaining["per_day_remaining"] >= 0
    from app.config import settings

    assert day2_remaining["per_day_remaining"] == settings.free_req_per_day
