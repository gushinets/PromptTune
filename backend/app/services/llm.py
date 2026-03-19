import logging
import re
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path
from dataclasses import dataclass

from litellm import acompletion
from litellm.exceptions import (
    APIConnectionError,
    APIError,
    AuthenticationError,
    BadRequestError,
    ContentPolicyViolationError,
    ContextWindowExceededError,
    InternalServerError,
    NotFoundError,
    OpenAIError,
    PermissionDeniedError,
    RateLimitError,
    Timeout as LitellmTimeout,
)

from app.config import settings
from app.security.redaction import redact_secrets
from app.services.errors import (
    UpstreamAuthError,
    UpstreamBadResponseError,
    UpstreamRateLimitError,
    UpstreamServiceError,
    UpstreamTimeoutError,
)

logger = logging.getLogger(__name__)

# Persist LiteLLM usage logs to a file (so they are not dependent on console log configuration).
_LOG_DIR = Path(__file__).resolve().parent / "logs"
_LOG_DIR.mkdir(parents=True, exist_ok=True)
_LOG_FILE = _LOG_DIR / "litellm.log"

logger.setLevel(logging.INFO)
_already_added = any(
    isinstance(h, RotatingFileHandler) and getattr(h, "baseFilename", None) == str(_LOG_FILE)
    for h in logger.handlers
)
if not _already_added:
    _handler = RotatingFileHandler(
        _LOG_FILE,
        maxBytes=5 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    _handler.setLevel(logging.INFO)
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(_handler)

SYSTEM_PROMPT = """You are an expert prompt engineer. Your task is to improve the user's prompt
to make it clearer, more specific, and more effective for AI assistants.

Rules:
- Return ONLY the improved prompt text, nothing else
- Do not add explanations, prefixes like "Here's the improved prompt:", or meta-commentary
- Preserve the original intent and language of the prompt
- Make the prompt more specific, structured, and actionable
- If the prompt is already good, make minimal improvements"""

STRIP_PATTERNS = [
    re.compile(r"^(Here'?s?\s+(the\s+)?improved\s+prompt:?\s*)", re.IGNORECASE),
    re.compile(r"^(Improved\s+prompt:?\s*)", re.IGNORECASE),
]


@dataclass(frozen=True)
class ImproveLLMResult:
    improved_text: str
    model: str
    provider: str | None
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None
    latency_ms: int
    upstream_id: str | None


def _normalize_response(text: str) -> str:
    text = text.strip()
    for pattern in STRIP_PATTERNS:
        text = pattern.sub("", text)
    return text.strip().strip('"').strip("'")


def _resolve_provider_api_key() -> str:
    api_key = settings.get_provider_api_key()
    if api_key:
        return api_key

    if settings.llm_backend == "OPENAI":
        raise UpstreamAuthError("Server OpenAI API key is not configured")
    raise UpstreamAuthError("Server OpenRouter API key is not configured")


def _infer_provider_from_model(model_id: str) -> str | None:
    if "/" in model_id:
        return model_id.split("/", 1)[0].lower() or None
    return None


def _usage_tokens(response: object) -> tuple[int | None, int | None, int | None]:
    usage = getattr(response, "usage", None)
    if usage is None:
        return None, None, None
    if isinstance(usage, dict):
        return (
            usage.get("prompt_tokens"),
            usage.get("completion_tokens"),
            usage.get("total_tokens"),
        )
    pt = getattr(usage, "prompt_tokens", None)
    ct = getattr(usage, "completion_tokens", None)
    tt = getattr(usage, "total_tokens", None)
    return pt, ct, tt


def _provider_from_response(response: object, model_id: str) -> str | None:
    hidden = getattr(response, "_hidden_params", None) or {}
    if isinstance(hidden, dict):
        for key in ("custom_llm_provider", "litellm_provider", "api_base"):
            val = hidden.get(key)
            if isinstance(val, str) and val:
                return val.lower()
    return _infer_provider_from_model(model_id)


def _map_litellm_error(exc: BaseException) -> UpstreamServiceError:
    if isinstance(exc, (AuthenticationError, PermissionDeniedError)):
        return UpstreamAuthError("Provider rejected API key")
    if isinstance(exc, RateLimitError):
        return UpstreamRateLimitError("Provider rate limit exceeded")
    if isinstance(exc, (LitellmTimeout, TimeoutError)):
        return UpstreamTimeoutError("Provider timeout")
    if isinstance(exc, APIConnectionError):
        safe = redact_secrets(str(exc)) or "Provider connection failed"
        return UpstreamServiceError(safe[:200])

    if isinstance(exc, OpenAIError):
        status = getattr(exc, "status_code", None)
        if status in (401, 403):
            return UpstreamAuthError("Provider rejected API key")
        if status == 429:
            return UpstreamRateLimitError("Provider rate limit exceeded")
        body = getattr(exc, "message", None) or getattr(exc, "body", None) or str(exc)
        safe = redact_secrets(str(body)) or "Provider request failed"
        return UpstreamServiceError(f"Provider API error ({status or '?'}): {safe[:200]}")

    if isinstance(
        exc,
        (
            BadRequestError,
            NotFoundError,
            ContextWindowExceededError,
            ContentPolicyViolationError,
            InternalServerError,
            APIError,
        ),
    ):
        safe = redact_secrets(str(exc)) or "Provider request failed"
        return UpstreamServiceError(safe[:200])

    safe_message = redact_secrets(str(exc)) or "Provider request failed"
    return UpstreamServiceError(safe_message[:200])


class LiteLLMClient:
    """Single entry point for chat completions via LiteLLM."""

    async def improve_text(
        self,
        text: str,
        *,
        request_id: str,
        installation_id: str,
        site: str | None,
    ) -> ImproveLLMResult:
        model_id = settings.litellm_model_id()
        api_key = _resolve_provider_api_key()
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ]
        extra_headers: dict[str, str] | None = None
        if settings.llm_backend == "OPENROUTER":
            extra_headers = {
                "HTTP-Referer": settings.openrouter_site_url or "https://prompttune.local",
                "X-Title": settings.openrouter_app_name or "PromptTune",
            }

        start = time.monotonic()
        try:
            response = await acompletion(
                model=model_id,
                messages=messages,
                api_key=api_key,
                max_tokens=2048,
                temperature=0.7,
                timeout=settings.llm_request_timeout_seconds,
                extra_headers=extra_headers,
            )
        except Exception as exc:
            raise _map_litellm_error(exc) from exc

        latency_ms = int((time.monotonic() - start) * 1000)

        if not getattr(response, "choices", None):
            raise UpstreamBadResponseError("Provider returned no choices")

        try:
            raw = response.choices[0].message.content or ""
        except (AttributeError, IndexError, TypeError) as exc:
            raise UpstreamBadResponseError("Provider response missing message content") from exc

        improved = _normalize_response(raw)
        model_used = getattr(response, "model", None) or model_id
        pt, ct, tt = _usage_tokens(response)
        provider = _provider_from_response(response, model_used)
        upstream_id = getattr(response, "id", None)

        logger.info(
            "llm_completion model=%s provider=%s prompt_tokens=%s completion_tokens=%s "
            "total_tokens=%s latency_ms=%s request_id=%s installation_id=%s site=%s",
            model_used,
            provider,
            pt,
            ct,
            tt,
            latency_ms,
            request_id,
            installation_id,
            site,
        )

        return ImproveLLMResult(
            improved_text=improved,
            model=model_used,
            provider=provider,
            prompt_tokens=pt,
            completion_tokens=ct,
            total_tokens=tt,
            latency_ms=latency_ms,
            upstream_id=upstream_id if isinstance(upstream_id, str) else None,
        )


_default_client = LiteLLMClient()


async def improve_text(
    text: str,
    *,
    request_id: str,
    installation_id: str,
    site: str | None,
) -> ImproveLLMResult:
    return await _default_client.improve_text(
        text,
        request_id=request_id,
        installation_id=installation_id,
        site=site,
    )
