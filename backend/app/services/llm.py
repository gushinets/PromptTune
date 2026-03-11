import re
import time

import httpx

from app.config import settings
from app.security.redaction import redact_secrets
from app.services.errors import (
    UpstreamAuthError,
    UpstreamBadResponseError,
    UpstreamRateLimitError,
    UpstreamServiceError,
    UpstreamTimeoutError,
)

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


def _normalize_response(text: str) -> str:
    text = text.strip()
    for pattern in STRIP_PATTERNS:
        text = pattern.sub("", text)
    return text.strip().strip('"').strip("'")


def _resolve_model_name() -> str:
    if settings.llm_backend == "OPENROUTER" and "/" not in settings.llm_model:
        return f"openai/{settings.llm_model}"
    return settings.llm_model


def _resolve_api_url() -> str:
    if settings.llm_backend == "OPENROUTER":
        return "https://openrouter.ai/api/v1/chat/completions"
    return "https://api.openai.com/v1/chat/completions"


def _resolve_provider_api_key() -> str:
    if settings.llm_backend == "OPENAI":
        if not settings.openai_api_key:
            raise UpstreamAuthError("Server OpenAI API key is not configured")
        return settings.openai_api_key
    if not settings.openrouter_api_key:
        raise UpstreamAuthError("Server OpenRouter API key is not configured")
    return settings.openrouter_api_key


def _build_headers() -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {_resolve_provider_api_key()}",
        "Content-Type": "application/json",
    }
    if settings.llm_backend == "OPENROUTER":
        headers["HTTP-Referer"] = "https://prompttune.local"
        headers["X-Title"] = "PromptTune"
    return headers


def _map_http_error(exc: httpx.HTTPStatusError) -> UpstreamServiceError:
    status_code = exc.response.status_code
    if status_code in (401, 403):
        return UpstreamAuthError("Provider rejected API key")
    if status_code == 429:
        return UpstreamRateLimitError("Provider rate limit exceeded")

    safe_message = redact_secrets(exc.response.text) or "Provider request failed"
    return UpstreamServiceError(f"Provider API error ({status_code}): {safe_message[:200]}")


async def _request_completion(text: str) -> dict:
    payload = {
        "model": _resolve_model_name(),
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        "max_tokens": 2048,
        "temperature": 0.7,
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                _resolve_api_url(),
                headers=_build_headers(),
                json=payload,
            )
        response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise UpstreamTimeoutError("Provider timeout") from exc
    except httpx.HTTPStatusError as exc:
        raise _map_http_error(exc) from exc
    except httpx.HTTPError as exc:
        safe_message = redact_secrets(str(exc)) or "Provider request failed"
        raise UpstreamServiceError(safe_message[:200]) from exc

    try:
        data = response.json()
        if not data.get("choices"):
            raise UpstreamBadResponseError("Provider returned no choices")
        return data
    except ValueError as exc:
        raise UpstreamBadResponseError("Provider returned invalid JSON") from exc


async def improve_text(text: str) -> tuple[str, str, int]:
    start = time.monotonic()
    data = await _request_completion(text)

    latency_ms = int((time.monotonic() - start) * 1000)
    try:
        raw = data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as exc:
        raise UpstreamBadResponseError("Provider response missing message content") from exc
    improved = _normalize_response(raw)
    model_used = data.get("model") or _resolve_model_name()

    return improved, model_used, latency_ms
