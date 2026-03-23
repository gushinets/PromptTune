from httpx import HTTPStatusError, Request, Response

from app.services.errors import UpstreamAuthError, UpstreamRateLimitError
from app.services.llm import _build_payload, _map_http_error, _normalize_response


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

    assert payload["max_completion_tokens"] == 2048
    assert payload["temperature"] == 0.7
    assert "max_tokens" not in payload


def test_build_payload_uses_openrouter_max_tokens(monkeypatch):
    monkeypatch.setattr("app.services.llm.settings.llm_backend", "OPENROUTER")
    monkeypatch.setattr("app.services.llm.settings.llm_model", "gpt-4o-mini")

    payload = _build_payload("hello")

    assert payload["max_tokens"] == 2048
    assert payload["temperature"] == 0.7
    assert "max_completion_tokens" not in payload


def test_build_payload_omits_temperature_for_gpt5(monkeypatch):
    monkeypatch.setattr("app.services.llm.settings.llm_backend", "OPENAI")
    monkeypatch.setattr("app.services.llm.settings.llm_model", "gpt-5-mini")

    payload = _build_payload("hello")

    assert payload["max_completion_tokens"] == 2048
    assert "temperature" not in payload
