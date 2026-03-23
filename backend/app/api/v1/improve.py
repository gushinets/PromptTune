import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import ImproveRequest, ImproveResponse
from app.api.validation import validate_improve_text_length
from app.dependencies import (
    ensure_installation_id_when_ip_present,
    get_client_ip,
    get_db,
    get_redis,
)
from app.services.prompt_service import PromptService

router = APIRouter()


@router.post("/improve", response_model=ImproveResponse)
async def improve(
    req: ImproveRequest,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
    client_ip: str = Depends(get_client_ip),
):
    await ensure_installation_id_when_ip_present(client_ip, req.installation_id, redis)
    validate_improve_text_length(req.text)

    service = PromptService(db=db, redis=redis)

    allowed, remaining = await service.check_rate_limit(
        installation_id=req.installation_id, ip=client_ip
    )
    if not allowed:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    try:
        result = await service.improve_prompt(
            text=req.text,
            installation_id=req.installation_id,
            client=req.client,
            client_version=req.client_version,
            site=req.site,
            page_url=req.page_url,
        )
    except Exception:
        await service.refund_rate_limit(installation_id=req.installation_id, ip=client_ip)
        raise

    return ImproveResponse(
        request_id=result.id,
        improved_text=result.improved_text,
        rate_limit=remaining,
    )
