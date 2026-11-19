import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import (
    EmailBonusConfirm,
    EmailBonusRequest,
    RateLimitInfo,
    RegisterInstallationRequest,
)
from app.config import settings
from app.dependencies import (
    ensure_installation_id_when_ip_present,
    get_client_ip,
    get_db,
    get_redis,
)
from app.services.abuse_limiter import allowance, throttle
from app.services.email_bonus import EmailBonusService
from app.services.quota import QuotaService

router = APIRouter()


async def with_minute_allowance(info: RateLimitInfo, redis, installation_id: str) -> RateLimitInfo:
    info.per_minute_remaining = await allowance(
        redis, "improve", installation_id, settings.free_req_per_min
    )
    return info


@router.get("/limits", response_model=RateLimitInfo)
async def get_limits(
    installation_id: str = Query(..., max_length=64),
    redis: aioredis.Redis = Depends(get_redis),
    ip: str = Depends(get_client_ip),
    db: AsyncSession = Depends(get_db),
):
    await ensure_installation_id_when_ip_present(ip, installation_id, redis)
    return await with_minute_allowance(
        await QuotaService(db).status(installation_id), redis, installation_id
    )


@router.post("/email/request", status_code=202)
async def request_email(
    req: EmailBonusRequest,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
    ip: str = Depends(get_client_ip),
):
    await ensure_installation_id_when_ip_present(ip, req.installation_id, redis)
    await throttle(redis, "email-ip", ip, 10, 3600)
    await throttle(redis, "email-installation", req.installation_id, 5, 3600)
    await throttle(redis, "email-address", req.email.strip().lower(), 5, 3600)
    await EmailBonusService(db).request(req.installation_id, req.email)
    return {
        "sent": True,
        "rate_limit": await with_minute_allowance(
            await QuotaService(db).status(req.installation_id), redis, req.installation_id
        ),
    }


@router.post("/email/confirm", response_model=RateLimitInfo)
async def confirm_email(
    req: EmailBonusConfirm,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
    ip: str = Depends(get_client_ip),
):
    await ensure_installation_id_when_ip_present(ip, req.installation_id, redis)
    await throttle(redis, "email-confirm", ip, 30, 60)
    return await with_minute_allowance(
        await EmailBonusService(db).confirm(req.installation_id, req.code),
        redis,
        req.installation_id,
    )


@router.post("/installations")
async def register_installation(
    req: RegisterInstallationRequest,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
    ip: str = Depends(get_client_ip),
):
    await ensure_installation_id_when_ip_present(ip, req.installation_id, redis)
    await throttle(redis, "installation-register", ip, 100, 3600)
    await QuotaService(db).register(req.installation_id, req.installed_at)
    return {"registered": True}
