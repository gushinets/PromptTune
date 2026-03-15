import logging
import uuid

import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import RateLimitInfo
from app.db.models import Installation, PromptImprovement
from app.services.llm import improve_text
from app.services.rate_limiter import RateLimiter

logger = logging.getLogger(__name__)


class PromptService:
    def __init__(self, db: AsyncSession, redis: aioredis.Redis):
        self.db = db
        self.rate_limiter = RateLimiter(redis)

    async def check_rate_limit(
        self, installation_id: str, ip: str
    ) -> tuple[bool, RateLimitInfo | None]:
        allowed, remaining = await self.rate_limiter.check(installation_id, ip)
        info = RateLimitInfo(**remaining) if remaining else None
        return allowed, info

    async def improve_prompt(
        self,
        text: str,
        installation_id: str,
        site: str | None = None,
        page_url: str | None = None,
    ) -> PromptImprovement:
        # Ensure installation exists
        await self._upsert_installation(installation_id)

        request_id = str(uuid.uuid4())

        try:
            improved_text, model_used, latency_ms = await improve_text(text)
            record = PromptImprovement(
                id=request_id,
                installation_id=installation_id,
                site=site,
                page_url=page_url,
                original_text=text,
                improved_text=improved_text,
                model=model_used,
                latency_ms=latency_ms,
                status="ok",
            )
        except Exception as e:
            logger.exception("LLM call failed")
            record = PromptImprovement(
                id=request_id,
                installation_id=installation_id,
                site=site,
                page_url=page_url,
                original_text=text,
                improved_text="",
                status="error",
                error=str(e),
            )
            self.db.add(record)
            await self.db.commit()
            raise

        self.db.add(record)
        await self.db.commit()
        return record

    async def _upsert_installation(self, installation_id: str) -> None:
        existing = await self.db.get(Installation, installation_id)
        if not existing:
            self.db.add(Installation(id=installation_id))
            await self.db.flush()
