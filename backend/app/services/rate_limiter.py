from datetime import UTC, datetime

import redis.asyncio as aioredis

from app.config import settings


class RateLimiter:
    def __init__(self, redis: aioredis.Redis):
        self.redis = redis

    async def get_remaining(
        self, installation_id: str, ip: str
    ) -> tuple[bool, dict[str, int]]:
        now = datetime.now(UTC)
        minute_bucket = now.strftime("%Y%m%d%H%M")
        day_bucket = now.strftime("%Y%m%d")

        keys = {
            "inst_min": f"rl:inst:min:{installation_id}:{minute_bucket}",
            "inst_day": f"rl:inst:day:{installation_id}:{day_bucket}",
            "ip_min": f"rl:ip:min:{ip}:{minute_bucket}",
            "ip_day": f"rl:ip:day:{ip}:{day_bucket}",
        }

        pipe = self.redis.pipeline()
        for key in keys.values():
            pipe.get(key)
        counts = await pipe.execute()

        current = {k: int(v or 0) for k, v in zip(keys, counts)}
        per_min = settings.free_req_per_min
        per_day = settings.free_req_per_day

        min_count = max(current["inst_min"], current["ip_min"])
        day_count = max(current["inst_day"], current["ip_day"])
        remaining = {
            "per_minute_remaining": max(0, per_min - min_count),
            "per_day_remaining": max(0, per_day - day_count),
            "per_minute_total": per_min,
            "per_day_total": per_day,
        }
        allowed = min_count < per_min and day_count < per_day
        return allowed, remaining

    async def check(
        self, installation_id: str, ip: str
    ) -> tuple[bool, dict[str, int]]:
        """Check and increment rate limits.

        Returns: (allowed, {per_minute_remaining, per_day_remaining})
        """
        allowed, remaining = await self.get_remaining(installation_id, ip)
        if not allowed:
            return False, remaining

        now = datetime.now(UTC)
        minute_bucket = now.strftime("%Y%m%d%H%M")
        day_bucket = now.strftime("%Y%m%d")
        keys = {
            "inst_min": f"rl:inst:min:{installation_id}:{minute_bucket}",
            "inst_day": f"rl:inst:day:{installation_id}:{day_bucket}",
            "ip_min": f"rl:ip:min:{ip}:{minute_bucket}",
            "ip_day": f"rl:ip:day:{ip}:{day_bucket}",
        }

        pipe = self.redis.pipeline()
        for key_name, key in keys.items():
            pipe.incr(key)
            ttl = 180 if "min" in key_name else 259200
            pipe.expire(key, ttl)
        await pipe.execute()

        return True, {
            "per_minute_remaining": max(0, remaining["per_minute_remaining"] - 1),
            "per_day_remaining": max(0, remaining["per_day_remaining"] - 1),
            "per_minute_total": remaining["per_minute_total"],
            "per_day_total": remaining["per_day_total"],
        }
