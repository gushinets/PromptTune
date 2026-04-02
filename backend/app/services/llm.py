import logging
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

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
)
from litellm.exceptions import (
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

logger.setLevel(logging.INFO)


def setup_file_logging() -> None:
    """Attach a stdout stream handler for this module's logger.

    Safe to call from application startup: does nothing if a matching handler
    already exists.
    """
    _already_added = any(
        isinstance(h, logging.StreamHandler) and getattr(h, "stream", None) is sys.stdout
        for h in logger.handlers
    )
    if _already_added:
        return

    _handler = logging.StreamHandler(sys.stdout)
    _handler.setLevel(logging.INFO)
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(_handler)


def _load_system_prompt() -> str:
    path = Path(__file__).with_name("system_prompt.txt")
    if not path.is_file():
        logger.error("system_prompt_missing path=%s", path)
        raise RuntimeError(
            f"System prompt file not found: {path}. "
            "Add system_prompt.txt next to llm.py with non-empty instructions."
        )
    raw = path.read_text(encoding="utf-8")
    content = raw.strip()
    if not content:
        logger.error("system_prompt_empty path=%s", path)
        raise RuntimeError(
            f"System prompt file is empty: {path}. Add non-empty instructions to system_prompt.txt."
        )
    logger.info("system_prompt_loaded path=%s chars=%s", path, len(content))
    return content


SYSTEM_PROMPT = _load_system_prompt()

STRIP_PATTERNS = [
    re.compile(r"^(Here'?s?\s+(the\s+)?improved\s+prompt:?\s*)", re.IGNORECASE),
    re.compile(r"^(Improved\s+prompt:?\s*)", re.IGNORECASE),
]
EMPTY_COMPLETION_RETRIES = 1


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
    attempt_count: int
    completion_tokens_budget_used: int


def _normalize_response(text: str) -> str:
    text = text.strip()
    for pattern in STRIP_PATTERNS:
        text = pattern.sub("", text)
    return text.strip().strip('"').strip("'")


def _choice_finish_reason(response: object) -> str | None:
    try:
        choices = getattr(response, "choices", None) or []
        if not choices:
            return None
        choice0 = choices[0]
        if isinstance(choice0, dict):
            value = choice0.get("finish_reason")
        else:
            value = getattr(choice0, "finish_reason", None)
        return value if isinstance(value, str) else None
    except Exception:
        return None


def _empty_completion_detail(response: object) -> str:
    reason = (_choice_finish_reason(response) or "").lower()
    if reason in ("length", "max_tokens"):
        return "token_exhaustion"
    return "empty_completion"


def _empty_completion_diagnostics(response: object) -> dict[str, str | None]:
    return {"finish_reason": _choice_finish_reason(response)}


def _should_retry_empty_completion(detail: str, attempt: int, max_attempts: int) -> bool:
    if attempt >= max_attempts:
        return False
    if detail == "token_exhaustion":
        return True
    return attempt <= EMPTY_COMPLETION_RETRIES


def _resolve_model_name(response: object, model_id: str) -> str:
    model_used = getattr(response, "model", None)
    if isinstance(model_used, str) and model_used.strip():
        return model_used
    return model_id


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
    safe_message = redact_secrets(str(exc)) or "Provider request failed"
    lowered = safe_message.lower()
    if "temperature" in lowered and ("not support" in lowered or "unsupported" in lowered):
        logger.error("temperature is not supported for model: %s", safe_message[:200])

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
        return UpstreamServiceError(safe_message[:200])

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

        completion_tokens = settings.llm_completion_tokens
        max_attempts = max(1, settings.llm_max_retries)
        response: Any = None
        improved: str = ""
        attempt = 0
        latency_ms = 0
        while attempt < max_attempts:
            attempt += 1
            start = time.monotonic()
            request_kwargs: dict[str, Any] = {
                "model": model_id,
                "messages": messages,
                "api_key": api_key,
                "max_tokens": completion_tokens,
                "timeout": settings.llm_request_timeout_seconds,
                "extra_headers": extra_headers,
            }
            if settings.llm_temperature is not None:
                request_kwargs["temperature"] = settings.llm_temperature
            try:
                response = await acompletion(**request_kwargs)
            except Exception as exc:
                raise _map_litellm_error(exc) from exc

            latency_ms = int((time.monotonic() - start) * 1000)

            if not getattr(response, "choices", None):
                raise UpstreamBadResponseError("Provider returned no choices")

            try:
                raw = response.choices[0].message.content
            except (AttributeError, IndexError, TypeError) as exc:
                raise UpstreamBadResponseError("Provider response missing message content") from exc

            if raw is None:
                raw = ""
            elif not isinstance(raw, str):
                raise UpstreamBadResponseError(
                    f"Provider message content must be a string, got {type(raw).__name__}"
                )

            improved = _normalize_response(raw)
            if not improved.strip():
                detail = _empty_completion_detail(response)
                diagnostics = _empty_completion_diagnostics(response)
                if not _should_retry_empty_completion(detail, attempt, max_attempts):
                    raise UpstreamBadResponseError(f"Provider returned empty completion ({detail})")
                if detail == "token_exhaustion":
                    completion_tokens = min(
                        completion_tokens * 2,
                        settings.llm_completion_tokens_retry_max,
                    )
                logger.warning(
                    "llm_empty_completion_retry model=%s attempt=%s detail=%s diagnostics=%s",
                    model_id,
                    attempt,
                    detail,
                    diagnostics,
                )
                continue

            if len(improved) > settings.prompt_output_max_chars:
                raise UpstreamBadResponseError(
                    f"Provider output exceeds max length {settings.prompt_output_max_chars}"
                )
            break

        if response is None:
            raise UpstreamBadResponseError("Provider returned empty completion")

        model_used = _resolve_model_name(response, model_id)
        pt, ct, tt = _usage_tokens(response)
        provider = _provider_from_response(response, model_used)
        upstream_id = getattr(response, "id", None)

        def _sanitize(value: str | None) -> str | None:
            if value is None:
                return None
            return value.replace("\r", "").replace("\n", "")

        logger.info(
            "llm_completion model=%s provider=%s prompt_tokens=%s completion_tokens=%s "
            "total_tokens=%s latency_ms=%s attempt_count=%s completion_tokens_budget_used=%s "
            "request_id=%s installation_id=%s site=%s",
            model_used,
            provider,
            pt,
            ct,
            tt,
            latency_ms,
            attempt,
            completion_tokens,
            _sanitize(request_id),
            _sanitize(installation_id),
            _sanitize(site),
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
            attempt_count=attempt,
            completion_tokens_budget_used=completion_tokens,
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
