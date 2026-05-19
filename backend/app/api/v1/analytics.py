import json
from datetime import UTC, datetime
from hashlib import sha256
from inspect import iscoroutine
from typing import Any

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import AnalyticsBatchRequest, AnalyticsBatchResponse, AnalyticsEventSource
from app.config import settings
from app.db.models import AnalyticsEvent
from app.dependencies import (
    ensure_installation_id_when_ip_present,
    get_client_ip,
    get_db,
    get_redis,
)

router = APIRouter()

_EXTENSION_SOURCES = {
    AnalyticsEventSource.background,
    AnalyticsEventSource.popup,
    AnalyticsEventSource.sidepanel,
    AnalyticsEventSource.content,
}
_FORBIDDEN_PROPERTY_KEYS = {
    "text",
    "prompt",
    "original_text",
    "improved_text",
    "page_url",
    "url",
    "html",
    "selection_text",
}
_FORBIDDEN_PROPERTY_KEYS_LOWER = {key.lower() for key in _FORBIDDEN_PROPERTY_KEYS}
_MAX_PROPERTIES_JSON_BYTES = 8 * 1024


def _collect_forbidden_keys(payload: Any) -> set[str]:
    found: set[str] = set()
    stack: list[Any] = [payload]

    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            for key, value in current.items():
                normalized_key = key.lower() if isinstance(key, str) else str(key).lower()
                if normalized_key in _FORBIDDEN_PROPERTY_KEYS_LOWER:
                    found.add(key)
                stack.append(value)
            continue
        if isinstance(current, list):
            stack.extend(current)
    return found


def _validate_event_payload(properties: dict[str, Any]) -> None:
    intersect = _collect_forbidden_keys(properties)
    if intersect:
        keys = ", ".join(sorted(intersect))
        raise HTTPException(status_code=422, detail=f"forbidden analytics properties: {keys}")

    try:
        encoded = json.dumps(properties, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError, RecursionError) as err:
        raise HTTPException(status_code=422, detail="analytics properties invalid") from err
    if len(encoded) > _MAX_PROPERTIES_JSON_BYTES:
        raise HTTPException(status_code=422, detail="analytics properties too large")


def _hash_ip(ip: str) -> str:
    payload = f"{ip}{settings.ip_salt}"
    return sha256(payload.encode()).hexdigest()


async def _enforce_ingest_rate_limit(redis: aioredis.Redis, client_ip: str) -> None:
    now_bucket = datetime.now(UTC).strftime("%Y%m%d%H%M")
    key = f"rl:analytics:ip:{_hash_ip(client_ip)}:{now_bucket}"
    pipe = redis.pipeline()
    pipe.incr(key)
    pipe.expire(key, 90)
    result = await pipe.execute()
    count = int(result[0]) if result else 0
    if count > settings.analytics_ingest_req_per_min:
        raise HTTPException(status_code=429, detail="analytics rate limit exceeded")


@router.post("/events", response_model=AnalyticsBatchResponse)
async def ingest_events(
    req: AnalyticsBatchRequest,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
    client_ip: str = Depends(get_client_ip),
) -> AnalyticsBatchResponse:
    if not settings.analytics_enabled:
        raise HTTPException(status_code=503, detail="analytics ingestion is disabled")

    await _enforce_ingest_rate_limit(redis, client_ip)

    accepted = 0
    deduplicated = 0
    rejected: list[dict[str, str]] = []

    for event in req.events:
        if event.source in _EXTENSION_SOURCES and not event.session_id:
            rejected.append(
                {
                    "event_id": event.event_id,
                    "reason": f"session_id is required for extension event source: {event.source}",
                }
            )
            continue

        try:
            _validate_event_payload(event.properties)
            if event.source in _EXTENSION_SOURCES:
                await ensure_installation_id_when_ip_present(client_ip, event.user_id, redis)
        except HTTPException as exc:
            rejected.append({"event_id": event.event_id, "reason": str(exc.detail)})
            continue

        try:
            inserted = False
            begin_ctx = db.begin_nested()
            if iscoroutine(begin_ctx):
                begin_ctx = await begin_ctx
            async with begin_ctx:
                existing = await db.get(AnalyticsEvent, event.event_id)
                if existing:
                    deduplicated += 1
                    continue

                db.add(
                    AnalyticsEvent(
                        event_id=event.event_id,
                        event_name=event.name,
                        user_id=event.user_id,
                        session_id=event.session_id,
                        occurred_at=event.occurred_at,
                        extension_version=event.extension_version,
                        os=event.os,
                        chrome_version=event.chrome_version,
                        user_plan=event.user_plan,
                        source=event.source,
                        properties=event.properties,
                    )
                )
                inserted = True
            if inserted:
                accepted += 1
        except IntegrityError:
            deduplicated += 1
            continue

    await db.commit()
    return AnalyticsBatchResponse(accepted=accepted, deduplicated=deduplicated, rejected=rejected)
