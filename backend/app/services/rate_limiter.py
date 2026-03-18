import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from hashlib import sha256

import redis.asyncio as aioredis

from app.config import settings

NowProvider = Callable[[], datetime]


class RateLimiter:
    def __init__(self, redis: aioredis.Redis, now: NowProvider = None):
        self.redis = redis
        self.now = now if now is not None else lambda: datetime.now(UTC)

    @staticmethod
    def _hash_ip(ip: str) -> str:
        return sha256(ip.encode()).hexdigest()[:16]

    @staticmethod
    def _seconds_until_midnight(now: datetime) -> int:
        next_midnight = datetime(now.year, now.month, now.day, tzinfo=UTC) + timedelta(days=1)
        seconds = (next_midnight - now).total_seconds()
        return int(seconds)

    TTL_MAPPING = 7_776_000  # 90 days in seconds

    async def resolve_bucket(self, installation_id: str, ip: str) -> str:
        ip_hash = self._hash_ip(ip)
        inst_key = f"map:inst:{installation_id}"
        ip_key = f"map:ip:{ip_hash}"

        # Step 1: Check if installation_id already has a bucket
        bucket_key = await self.redis.get(inst_key)
        if bucket_key is not None:
            await self.redis.expire(inst_key, self.TTL_MAPPING)
            return bucket_key.decode() if isinstance(bucket_key, bytes) else bucket_key

        # Step 2: Check if IP already has a bucket (user reset their installation_id)
        bucket_key = await self.redis.get(ip_key)
        if bucket_key is not None:
            bucket_key = bucket_key.decode() if isinstance(bucket_key, bytes) else bucket_key
            await self.redis.set(inst_key, bucket_key, ex=self.TTL_MAPPING)
            await self.redis.expire(ip_key, self.TTL_MAPPING)
            return bucket_key

        # Step 3: Brand new identity — create fresh bucket
        bucket_key = str(uuid.uuid4())
        await self.redis.set(inst_key, bucket_key, ex=self.TTL_MAPPING)
        await self.redis.set(ip_key, bucket_key, ex=self.TTL_MAPPING)
        return bucket_key

    async def get_remaining(self, installation_id: str, ip: str) -> tuple[bool, dict[str, int]]:
        bucket_key = await self.resolve_bucket(installation_id, ip)
        now = self.now()

        day_key = f"rl:{bucket_key}:d:{now.strftime('%Y%m%d')}"
        min_key = f"rl:{bucket_key}:m:{now.strftime('%Y%m%d%H%M')}"

        pipe = self.redis.pipeline()
        pipe.get(day_key)
        pipe.get(min_key)
        day_val, min_val = await pipe.execute()

        per_min = settings.free_req_per_min
        per_day = settings.free_req_per_day

        day_count = int(day_val or 0)
        min_count = int(min_val or 0)

        per_day_remaining = max(0, min(per_day, per_day - day_count))
        per_min_remaining = max(0, min(per_min, per_min - min_count))

        allowed = per_min_remaining > 0 and per_day_remaining > 0
        return allowed, {
            "per_minute_remaining": per_min_remaining,
            "per_day_remaining": per_day_remaining,
        }

    async def check(self, installation_id: str, ip: str) -> tuple[bool, dict[str, int]]:
        """Check and increment rate limits.

        Returns: (allowed, {per_minute_remaining, per_day_remaining})
        """
        bucket_key = await self.resolve_bucket(installation_id, ip)
        now = self.now()

        date_str = now.strftime("%Y%m%d")
        minute_str = now.strftime("%Y%m%d%H%M")

        day_key = f"rl:{bucket_key}:d:{date_str}"
        min_key = f"rl:{bucket_key}:m:{minute_str}"

        # Read current counts atomically
        day_val, min_val = await self.redis.mget(day_key, min_key)
        day_count = int(day_val or 0)
        min_count = int(min_val or 0)

        per_day = settings.free_req_per_day
        per_min = settings.free_req_per_min

        remaining = {
            "per_day_remaining": max(0, per_day - day_count),
            "per_minute_remaining": max(0, per_min - min_count),
        }

        if min_count >= per_min or day_count >= per_day:
            return False, remaining

        # Increment both counters in a pipeline
        day_ttl = self._seconds_until_midnight(now) + 3600
        min_ttl = 90

        pipe = self.redis.pipeline()
        pipe.incr(day_key)
        pipe.expire(day_key, day_ttl)
        pipe.incr(min_key)
        pipe.expire(min_key, min_ttl)
        await pipe.execute()

        return True, {
            "per_day_remaining": max(0, remaining["per_day_remaining"] - 1),
            "per_minute_remaining": max(0, remaining["per_minute_remaining"] - 1),
        }
