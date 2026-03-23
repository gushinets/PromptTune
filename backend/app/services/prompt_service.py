import logging
import uuid

import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import RateLimitInfo
from app.db.models import Installation, PromptImprovement
from app.security.redaction import redact_secrets
from app.services.errors import UpstreamServiceError
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

    async def refund_rate_limit(self, installation_id: str, ip: str) -> RateLimitInfo | None:
        remaining = await self.rate_limiter.refund(installation_id, ip)
        return RateLimitInfo(**remaining) if remaining else None

    async def improve_prompt(
        self,
        text: str,
        installation_id: str,
        client: str | None = None,
        client_version: str | None = None,
        site: str | None = None,
        page_url: str | None = None,
    ) -> PromptImprovement:
        await self._upsert_installation(installation_id)

        request_id = str(uuid.uuid4())

        try:
            improved_text, model_used, latency_ms = await improve_text(text)
            record = PromptImprovement(
                id=request_id,
                installation_id=installation_id,
                client=client,
                client_version=client_version,
                site=site,
                page_url=page_url,
                original_text=text,
                improved_text=improved_text,
                model=model_used,
                latency_ms=latency_ms,
                status="ok",
            )
        except UpstreamServiceError as exc:
            logger.warning(
                "LLM call failed req_id=%s installation_id=%s error_code=%s",
                request_id,
                installation_id,
                exc.error_code,
            )
            record = PromptImprovement(
                id=request_id,
                installation_id=installation_id,
                client=client,
                client_version=client_version,
                site=site,
                page_url=page_url,
                original_text=text,
                improved_text="",
                status="error",
                error=exc.error_code,
            )
            self.db.add(record)
            await self.db.commit()
            raise
        except Exception as exc:
            logger.exception(
                "Unexpected LLM failure req_id=%s installation_id=%s detail=%s",
                request_id,
                installation_id,
                redact_secrets(str(exc)) or "unknown",
            )
            record = PromptImprovement(
                id=request_id,
                installation_id=installation_id,
                client=client,
                client_version=client_version,
                site=site,
                page_url=page_url,
                original_text=text,
                improved_text="",
                status="error",
                error="INTERNAL_ERROR",
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
