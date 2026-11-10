import asyncio

import anyio
import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import ImproveRequest, ImproveResponse
from app.api.validation import validate_improve_text_length
from app.dependencies import (
    ensure_installation_id_when_ip_present,
    get_client_ip,
    get_db,
    get_redis,
)
from app.goals import normalize_goal_selection
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


async def _wait_for_disconnect(request: Request) -> None:
    # FastAPI has already consumed the body before invoking this endpoint.
    while (await request.receive())["type"] != "http.disconnect":
        pass


@router.post("/improve", response_model=ImproveResponse)
async def improve(
    req: ImproveRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
    client_ip: str = Depends(get_client_ip),
):
    await ensure_installation_id_when_ip_present(client_ip, req.installation_id, redis)
    validate_improve_text_length(req.text)

    service = PromptService(db=db, redis=redis)
    audience_mode, goal = normalize_goal_selection(req.audience_mode, req.goal)

    # Shield the short Redis reservation so cancellation cannot lose its result
    # after Redis has charged quota but before the endpoint observes it.
    reservation = asyncio.create_task(
        service.check_rate_limit(installation_id=req.installation_id, ip=client_ip)
    )
    try:
        allowed, remaining = await asyncio.shield(reservation)
    except asyncio.CancelledError:
        with anyio.CancelScope(shield=True):
            allowed, _ = await reservation
            if allowed:
                await service.refund_rate_limit(installation_id=req.installation_id, ip=client_ip)
        raise
    if not allowed:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    work = asyncio.create_task(
        service.improve_prompt(
            text=req.text,
            installation_id=req.installation_id,
            audience_mode=audience_mode,
            goal=goal,
            client=req.client,
            client_version=req.client_version,
            site=req.site,
            page_url=req.page_url,
        )
    )
    disconnected = asyncio.create_task(_wait_for_disconnect(request))
    refund = False
    try:
        await asyncio.wait({work, disconnected}, return_when=asyncio.FIRST_COMPLETED)
        # A completed result wins a simultaneous disconnect: it consumed an attempt.
        if work.done():
            result = work.result()
        else:
            disconnected.result()
            refund = True
            return Response(status_code=499)
        return ImproveResponse(
            request_id=result.id,
            improved_text=result.improved_text,
            changes=_extract_changes(result.llm_meta),
            model=result.model,
            latency_ms=result.latency_ms,
            rate_limit=remaining,
        )
    except Exception:
        refund = True
        raise
    except asyncio.CancelledError:
        refund = not (work.done() and not work.cancelled() and work.exception() is None)
        raise
    finally:
        # Middleware uses AnyIO cancellation scopes. Shield cleanup so it can await
        # the cancelled LLM task and Redis refund even when that scope is cancelled.
        with anyio.CancelScope(shield=True):
            for task in (work, disconnected):
                if not task.done():
                    task.cancel()
            await asyncio.gather(work, disconnected, return_exceptions=True)
            if refund:
                await service.refund_rate_limit(installation_id=req.installation_id, ip=client_ip)
