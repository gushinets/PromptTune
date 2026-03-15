import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import SavePromptRequest, SavePromptResponse
from app.db.models import PromptImprovement
from app.dependencies import get_db

router = APIRouter()


@router.post("/prompts", response_model=SavePromptResponse)
async def save_prompt(
    req: SavePromptRequest,
    db: AsyncSession = Depends(get_db),
):
    record = PromptImprovement(
        id=str(uuid.uuid4()),
        installation_id=req.installation_id,
        original_text=req.original_text,
        improved_text=req.improved_text,
        site=req.site,
        page_url=req.page_url,
        status="saved",
    )
    db.add(record)
    await db.commit()

    return SavePromptResponse(prompt_id=record.id)
