import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import AnalyticsBatchRequest, AnalyticsBatchResponse
from app.config import settings
from app.dependencies import get_db
from app.db.models import AnalyticsEvent

router = APIRouter()

_EXTENSION_SOURCES = {"background", "popup", "sidepanel", "content"}
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
_MAX_PROPERTIES_JSON_BYTES = 8 * 1024


def _validate_event_payload(properties: dict[str, Any]) -> None:
    intersect = _FORBIDDEN_PROPERTY_KEYS.intersection(properties.keys())
    if intersect:
        keys = ", ".join(sorted(intersect))
        raise HTTPException(status_code=422, detail=f"forbidden analytics properties: {keys}")

    encoded = json.dumps(properties, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    if len(encoded) > _MAX_PROPERTIES_JSON_BYTES:
        raise HTTPException(status_code=422, detail="analytics properties too large")


@router.post("/events", response_model=AnalyticsBatchResponse)
async def ingest_events(
    req: AnalyticsBatchRequest,
    db: AsyncSession = Depends(get_db),
) -> AnalyticsBatchResponse:
    if not settings.analytics_enabled:
        raise HTTPException(status_code=503, detail="analytics ingestion is disabled")

    accepted = 0
    deduplicated = 0

    for event in req.events:
        if event.source in _EXTENSION_SOURCES and not event.session_id:
            raise HTTPException(
                status_code=422,
                detail=f"session_id is required for extension event source: {event.source}",
            )

        _validate_event_payload(event.properties)

        existing = await db.get(AnalyticsEvent, event.event_id)
        if existing:
            deduplicated += 1
            continue

        db.add(
            AnalyticsEvent(
                event_id=event.event_id,
                event_name=event.name.value,
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
        accepted += 1

    await db.commit()
    return AnalyticsBatchResponse(accepted=accepted, deduplicated=deduplicated)
