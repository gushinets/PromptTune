from pydantic import BaseModel, Field


class ImproveRequest(BaseModel):
    text: str = Field(..., max_length=8000)
    installation_id: str = Field(..., max_length=64)
    client: str = Field(..., max_length=64)
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
    rate_limit: RateLimitInfo | None = None


class SavePromptRequest(BaseModel):
    installation_id: str = Field(..., max_length=64)
    client: str = Field(..., max_length=64)
    client_version: str | None = Field(None, max_length=64)
    original_text: str = Field(..., max_length=8000)
    improved_text: str = Field(..., max_length=8000)
    site: str | None = Field(None, max_length=128)
    page_url: str | None = Field(None, max_length=2048)
    meta: dict | None = None


class SavePromptResponse(BaseModel):
    prompt_id: str
