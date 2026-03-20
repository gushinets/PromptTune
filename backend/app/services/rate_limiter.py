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
    def _hash_installation(installation_id: str) -> str:
        payload = f"{installation_id}{settings.installation_id_salt}"
        return sha256(payload.encode()).hexdigest()

    @staticmethod
    def _hash_ip(ip: str) -> str:
        payload = f"{ip}{settings.ip_salt}"
        return sha256(payload.encode()).hexdigest()

    @staticmethod
    def _decode(value: str | bytes | None) -> str | None:
        if value is None:
            return None
        return value.decode() if isinstance(value, bytes) else value

    @staticmethod
    def _seconds_until_midnight(now: datetime) -> int:
        next_midnight = datetime(now.year, now.month, now.day, tzinfo=UTC) + timedelta(days=1)
        seconds = (next_midnight - now).total_seconds()
        return int(seconds)

    TTL_CANON_INST = 15_552_000  # 180 days
    TTL_CANON_IP = 2_592_000  # 30 days

    async def resolve_bucket(self, installation_id: str, ip: str) -> str:
        inst_hash = self._hash_installation(installation_id)
        ip_hash = self._hash_ip(ip)
        inst_key = f"canon:inst:{inst_hash}"
        ip_key = f"canon:ip:{ip_hash}"

        canon_by_inst, canon_by_ip = await self.redis.mget(inst_key, ip_key)
        canon_by_inst = self._decode(canon_by_inst)
        canon_by_ip = self._decode(canon_by_ip)

        if canon_by_inst:
            canon_id = canon_by_inst
        elif canon_by_ip:
            canon_id = canon_by_ip
        else:
            canon_id = inst_hash

        # Keep both handles attached to the same bucket.
        pipe = self.redis.pipeline()
        pipe.set(inst_key, canon_id, ex=self.TTL_CANON_INST)
        pipe.set(ip_key, canon_id, ex=self.TTL_CANON_IP)
        await pipe.execute()
        return canon_id

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
            "per_minute_total": remaining["per_minute_total"],
            "per_day_total": remaining["per_day_total"],
        }
