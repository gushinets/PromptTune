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
from app.services.errors import UpstreamServiceError
from app.services.prompt_service import PromptService

router = APIRouter()


def _extract_changes(result_meta: object) -> list[str] | None:
    if not isinstance(result_meta, dict):
        return None

    raw_changes = result_meta.get("changes")
    if not isinstance(raw_changes, list):
        return None

    changes = [line.strip() for line in raw_changes if isinstance(line, str) and line.strip()]
    return changes or None


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
            goal=req.goal,
            client=req.client,
            client_version=req.client_version,
            site=req.site,
            page_url=req.page_url,
        )
    except UpstreamServiceError:
        await service.refund_rate_limit(installation_id=req.installation_id, ip=client_ip)
        raise

    return ImproveResponse(
        request_id=result.id,
        improved_text=result.improved_text,
        changes=_extract_changes(result.llm_meta),
        rate_limit=remaining,
    )
