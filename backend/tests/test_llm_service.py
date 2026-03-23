import pytest
from httpx import HTTPStatusError, Request, Response

from app.config import settings
from app.services.errors import (
    UpstreamAuthError,
    UpstreamBadResponseError,
    UpstreamRateLimitError,
    UpstreamServiceError,
)
from app.services.llm import (
    _build_payload,
    _extract_message_content,
    _map_http_error,
    _normalize_response,
    improve_text,
)


def test_strips_prefix():
    assert _normalize_response("Here's the improved prompt: better text") == "better text"
    assert _normalize_response("Improved prompt: better text") == "better text"


def test_strips_quotes():
    assert _normalize_response('"quoted response"') == "quoted response"
    assert _normalize_response("'single quoted'") == "single quoted"


def test_preserves_clean_response():
    assert _normalize_response("already clean") == "already clean"


def test_strips_whitespace():
    assert _normalize_response("  padded  ") == "padded"


def test_extracts_text_from_structured_content():
    data = {
        "choices": [
            {
                "message": {
                    "content": [
                        {"type": "text", "text": "first line"},
                        {"type": "text", "text": "second line"},
                    ]
                }
            }
        ]
    }

    assert _extract_message_content(data) == "first line\nsecond line"


def test_extracts_text_from_nested_structured_content():
    data = {
        "choices": [
            {
                "message": {
                    "content": [
                        {"type": "output_text", "text": {"value": "first line"}},
                        {"type": "output_text", "content": "second line"},
                    ]
                }
            }
        ]
    }

    assert _extract_message_content(data) == "first line\nsecond line"


def test_extracts_text_from_legacy_choice_text():
    data = {
        "choices": [
            {
                "text": "legacy completion",
            }
        ]
    }

    assert _extract_message_content(data) == "legacy completion"


@pytest.mark.asyncio
async def test_improve_text_rejects_empty_completion(monkeypatch):
    async def fake_request(_text: str, completion_tokens: int | None = None):
        return {
            "choices": [{"message": {"content": '""'}}],
            "model": "gpt-4o-mini",
        }

    monkeypatch.setattr("app.services.llm._request_completion", fake_request)

    with pytest.raises(UpstreamBadResponseError, match="empty completion"):
        await improve_text("hello")


@pytest.mark.asyncio
async def test_improve_text_retries_after_empty_completion(monkeypatch):
    responses = iter(
        [
            {
                "choices": [{"message": {"content": ""}}],
                "model": "gpt-4o-mini",
                "usage": {"completion_tokens": 0},
            },
            {
                "choices": [{"message": {"content": "better result"}}],
                "model": "gpt-4o-mini",
            },
        ]
    )
    seen_completion_tokens: list[int | None] = []

    async def fake_request(_text: str, completion_tokens: int | None = None):
        seen_completion_tokens.append(completion_tokens)
        return next(responses)

    monkeypatch.setattr("app.services.llm._request_completion", fake_request)

    improved, model_used, _latency_ms = await improve_text("hello")

    assert improved == "better result"
    assert model_used == "gpt-4o-mini"
    assert seen_completion_tokens == [settings.llm_completion_tokens, settings.llm_completion_tokens]


@pytest.mark.asyncio
async def test_improve_text_retries_with_more_tokens_after_length_stop(monkeypatch):
    responses = iter(
        [
            {
                "choices": [{"message": {"content": ""}, "finish_reason": "length"}],
                "model": "gpt-5-mini",
                "usage": {"completion_tokens": 2048},
            },
            {
                "choices": [{"message": {"content": "better result"}}],
                "model": "gpt-5-mini",
            },
        ]
    )
    seen_completion_tokens: list[int | None] = []

    async def fake_request(_text: str, completion_tokens: int | None = None):
        seen_completion_tokens.append(completion_tokens)
        return next(responses)

    monkeypatch.setattr("app.services.llm._request_completion", fake_request)
    monkeypatch.setattr("app.services.llm.settings.llm_backend", "OPENAI")
    monkeypatch.setattr("app.services.llm.settings.llm_model", "gpt-5-mini")

    improved, model_used, _latency_ms = await improve_text("hello")

    assert improved == "better result"
    assert model_used == "gpt-5-mini"
    assert seen_completion_tokens == [
        settings.llm_completion_tokens,
        settings.llm_completion_tokens_retry_max,
    ]


@pytest.mark.asyncio
async def test_improve_text_surfaces_choice_error(monkeypatch):
    async def fake_request(_text: str, completion_tokens: int | None = None):
        return {
            "choices": [
                {
                    "message": {"content": ""},
                    "error": {"message": "Provider overloaded", "code": 502},
                }
            ],
            "model": "gpt-4o-mini",
        }

    monkeypatch.setattr("app.services.llm._request_completion", fake_request)

    with pytest.raises(UpstreamServiceError, match="Provider overloaded"):
        await improve_text("hello")


def test_maps_auth_http_error_to_safe_exception():
    request = Request("POST", "https://example.com")
    response = Response(401, request=request, text="Invalid token sk-or-v1-secret123")
    error = HTTPStatusError("boom", request=request, response=response)

    mapped = _map_http_error(error)

    assert isinstance(mapped, UpstreamAuthError)


def test_maps_rate_limit_http_error_to_safe_exception():
    request = Request("POST", "https://example.com")
    response = Response(429, request=request, text="Too many requests")
    error = HTTPStatusError("boom", request=request, response=response)

    mapped = _map_http_error(error)

    assert isinstance(mapped, UpstreamRateLimitError)


def test_build_payload_uses_openai_completion_tokens(monkeypatch):
    monkeypatch.setattr("app.services.llm.settings.llm_backend", "OPENAI")
    monkeypatch.setattr("app.services.llm.settings.llm_model", "gpt-4o-mini")

    payload = _build_payload("hello")

    assert payload["max_completion_tokens"] == settings.llm_completion_tokens
    assert payload["temperature"] == 0.7
    assert "max_tokens" not in payload
    assert "reasoning" not in payload


def test_build_payload_uses_openrouter_max_tokens(monkeypatch):
    monkeypatch.setattr("app.services.llm.settings.llm_backend", "OPENROUTER")
    monkeypatch.setattr("app.services.llm.settings.llm_model", "gpt-4o-mini")

    payload = _build_payload("hello")

    assert payload["max_tokens"] == settings.llm_completion_tokens
    assert payload["temperature"] == 0.7
    assert "max_completion_tokens" not in payload
    assert "reasoning" not in payload


def test_build_payload_uses_reasoning_budget_for_gpt5(monkeypatch):
    monkeypatch.setattr("app.services.llm.settings.llm_backend", "OPENAI")
    monkeypatch.setattr("app.services.llm.settings.llm_model", "gpt-5-mini")

    payload = _build_payload("hello")

    assert payload["max_completion_tokens"] == settings.llm_completion_tokens
    assert "temperature" not in payload
    assert payload["reasoning"] == {"effort": "low"}


@pytest.mark.asyncio
async def test_improve_text_rejects_output_exceeding_configured_limit(monkeypatch):
    async def fake_request(_text: str, completion_tokens: int | None = None):
        return {
            "choices": [
                {
                    "message": {
                        "content": "x" * (settings.prompt_output_max_chars + 1),
                    }
                }
            ],
            "model": "gpt-4o-mini",
        }

    monkeypatch.setattr("app.services.llm._request_completion", fake_request)

    with pytest.raises(UpstreamBadResponseError, match="exceeding configured maximum length"):
        await improve_text("hello")
