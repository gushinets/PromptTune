from typing import Literal

from pydantic import BaseModel, Field

ImproveGoal = Literal["general", "clarity", "structure", "concise", "persuasive"]


class ImproveRequest(BaseModel):
    text: str
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
    changes: list[str] | None = None
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
