from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from litellm.exceptions import AuthenticationError, RateLimitError

from app.services.errors import UpstreamAuthError, UpstreamRateLimitError
from app.services.llm import LiteLLMClient, SYSTEM_PROMPT, _normalize_response, improve_text


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


@pytest.mark.asyncio
async def test_improve_text_includes_system_prompt_and_user_message():
    mock_response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="out"))],
        model="gpt-4o-mini",
        usage=SimpleNamespace(prompt_tokens=1, completion_tokens=2, total_tokens=3),
        id="id-1",
        _hidden_params={},
    )
    with (
        patch("app.services.llm._resolve_provider_api_key", return_value="sk-test"),
        patch("app.services.llm.acompletion", new_callable=AsyncMock) as ac,
    ):
        ac.return_value = mock_response
        result = await improve_text(
            "hello",
            request_id="req-a",
            installation_id="inst-b",
            site="example.com",
        )

    ac.assert_awaited_once()
    kwargs = ac.await_args.kwargs
    assert kwargs["messages"][0]["role"] == "system"
    assert kwargs["messages"][0]["content"] == SYSTEM_PROMPT
    assert kwargs["messages"][1] == {"role": "user", "content": "hello"}
    assert result.improved_text == "out"
    assert result.model == "gpt-4o-mini"
    assert result.prompt_tokens == 1
    assert result.completion_tokens == 2
    assert result.total_tokens == 3


@pytest.mark.asyncio
async def test_improve_text_maps_authentication_error():
    client = LiteLLMClient()
    with (
        patch("app.services.llm._resolve_provider_api_key", return_value="sk-test"),
        patch(
            "app.services.llm.acompletion",
            new=AsyncMock(
                side_effect=AuthenticationError("nope", "openrouter", "openrouter/openai/x")
            ),
        ),
    ):
        with pytest.raises(UpstreamAuthError):
            await client.improve_text(
                "x",
                request_id="r1",
                installation_id="i1",
                site=None,
            )


@pytest.mark.asyncio
async def test_improve_text_maps_rate_limit_error():
    client = LiteLLMClient()
    with (
        patch("app.services.llm._resolve_provider_api_key", return_value="sk-test"),
        patch(
            "app.services.llm.acompletion",
            new=AsyncMock(side_effect=RateLimitError("slow down", "openrouter", "m")),
        ),
    ):
        with pytest.raises(UpstreamRateLimitError):
            await client.improve_text(
                "x",
                request_id="r1",
                installation_id="i1",
                site=None,
            )


@pytest.mark.asyncio
async def test_improve_text_logs_do_not_include_api_key(caplog):
    import logging

    caplog.set_level(logging.INFO)
    mock_response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))],
        model="m",
        usage=None,
        id=None,
        _hidden_params={},
    )
    fake_key = "sk-proj-super-secret-not-in-logs"
    with (
        patch("app.services.llm._resolve_provider_api_key", return_value=fake_key),
        patch("app.services.llm.acompletion", new=AsyncMock(return_value=mock_response)),
    ):
        await improve_text(
            "hi",
            request_id="rid",
            installation_id="iid",
            site="s",
        )

    joined = " ".join(r.message for r in caplog.records)
    assert fake_key not in joined
