"""Short request throttles, independent from the durable improvement allowance."""

from hashlib import sha256

from fastapi import HTTPException

from app.config import settings

_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
"""


def _key(scope: str, identity: str) -> str:
    digest = sha256(f"{settings.ip_salt}:{identity}".encode()).hexdigest()
    return f"abuse:{scope}:{digest}"


async def allowance(redis, scope: str, identity: str, maximum: int) -> int:
    count = int(await redis.get(_key(scope, identity)) or 0)
    return max(0, maximum - count)


async def throttle(redis, scope: str, identity: str, maximum: int, seconds: int) -> int:
    count = await redis.eval(_SCRIPT, 1, _key(scope, identity), seconds)
    if count > maximum:
        raise HTTPException(
            429, "Too many requests. Please try again later", headers={"Retry-After": str(seconds)}
        )

    return max(0, maximum - count)
