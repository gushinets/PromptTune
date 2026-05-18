from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from app.goals import AudienceMode, ImproveGoal


class ImproveRequest(BaseModel):
    text: str
    audience_mode: AudienceMode | None = None
    goal: ImproveGoal | None = None
    installation_id: str = Field(..., max_length=64)
    client: str | None = Field(None, max_length=64)
    client_version: str | None = Field(None, max_length=64)
    site: str | None = Field(None, max_length=128)
    page_url: str | None = Field(None, max_length=2048)
    client_ts: float | None = None


class RateLimitInfo(BaseModel):
    per_minute_remaining: int
    per_day_remaining: int
    per_minute_total: int
    per_day_total: int


class ImproveResponse(BaseModel):
    request_id: str
    improved_text: str
    changes: list[str] | None = Field(default=None, max_length=5)
    model: str | None = Field(default=None, max_length=128)
    latency_ms: int | None = None
    rate_limit: RateLimitInfo | None = None


class SavePromptRequest(BaseModel):
    installation_id: str = Field(..., max_length=64)
    client: str = Field(..., max_length=64)
    client_version: str | None = Field(None, max_length=64)
    original_text: str
    improved_text: str
    site: str | None = Field(None, max_length=128)
    page_url: str | None = Field(None, max_length=2048)
    meta: dict | None = None


class SavePromptResponse(BaseModel):
    prompt_id: str


class AnalyticsEventName(str, Enum):
    extension_installed = "extension_installed"
    onboarding_completed = "onboarding_completed"
    onboarding_abandoned = "onboarding_abandoned"
    first_prompt_submitted = "first_prompt_submitted"
    first_result_copied = "first_result_copied"
    popup_opened = "popup_opened"
    prompt_submitted = "prompt_submitted"
    result_displayed = "result_displayed"
    result_copied = "result_copied"
    result_regenerated = "result_regenerated"
    api_error = "api_error"
    extension_disabled = "extension_disabled"
    uninstall_reason_submitted = "uninstall_reason_submitted"


class AnalyticsEventIn(BaseModel):
    event_id: str = Field(..., min_length=1, max_length=64)
    name: AnalyticsEventName
    user_id: str = Field(..., min_length=1, max_length=64)
    session_id: str | None = Field(default=None, max_length=64)
    occurred_at: datetime
    extension_version: str | None = Field(default=None, max_length=64)
    os: str | None = Field(default=None, max_length=32)
    chrome_version: str | None = Field(default=None, max_length=128)
    user_plan: str | None = Field(default=None, max_length=32)
    source: str | None = Field(default=None, max_length=32)
    properties: dict[str, Any] = Field(default_factory=dict)


class AnalyticsBatchRequest(BaseModel):
    events: list[AnalyticsEventIn] = Field(..., min_length=1, max_length=50)


class AnalyticsBatchResponse(BaseModel):
    accepted: int
    deduplicated: int
    rejected: list[dict[str, str]] = Field(default_factory=list)
