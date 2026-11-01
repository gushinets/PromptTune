from fastapi import APIRouter
from pydantic import BaseModel

from app.config import settings

router = APIRouter()


class PublicConfig(BaseModel):
    prompt_input_max_chars: int


@router.get("/config", response_model=PublicConfig)
async def get_public_config():
    return PublicConfig(prompt_input_max_chars=settings.prompt_input_max_chars)
