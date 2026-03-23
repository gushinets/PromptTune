import uuid

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import SavePromptRequest, SavePromptResponse
from app.api.validation import validate_prompt_save_lengths
from app.db.models import PromptImprovement
from app.dependencies import (
    ensure_installation_id_when_ip_present,
    get_client_ip,
    get_db,
    get_redis,
)

router = APIRouter()


@router.post("/prompts", response_model=SavePromptResponse)
async def save_prompt(
    req: SavePromptRequest,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
    client_ip: str = Depends(get_client_ip),
):
    await ensure_installation_id_when_ip_present(client_ip, req.installation_id, redis)
    validate_prompt_save_lengths(
        original_text=req.original_text,
        improved_text=req.improved_text,
    )

    record = PromptImprovement(
        id=str(uuid.uuid4()),
        installation_id=req.installation_id,
        client=req.client,
        client_version=req.client_version,
        original_text=req.original_text,
        improved_text=req.improved_text,
        site=req.site,
        page_url=req.page_url,
        status="saved",
    )
    db.add(record)
    await db.commit()

    return SavePromptResponse(prompt_id=record.id)
