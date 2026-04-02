import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from litellm.exceptions import AuthenticationError, RateLimitError

from app.services.errors import (
    UpstreamAuthError,
    UpstreamBadResponseError,
    UpstreamRateLimitError,
    UpstreamServiceError,
)
from app.services.llm import SYSTEM_PROMPT, LiteLLMClient, _normalize_response, improve_text


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
        patch("app.services.llm.settings.llm_temperature", None),
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
    assert kwargs["max_tokens"] > 0
    assert ("temperature" in kwargs) is False
    assert result.improved_text == "out"
    assert result.model == "gpt-4o-mini"
    assert result.prompt_tokens == 1
    assert result.completion_tokens == 2
    assert result.total_tokens == 3


@pytest.mark.asyncio  # SIM117 fix
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
        pytest.raises(UpstreamAuthError),
    ):
        await client.improve_text(
            "x",
            request_id="r1",
            installation_id="i1",
            site=None,
        )


@pytest.mark.asyncio  # SIM117 fix
async def test_improve_text_maps_rate_limit_error():
    client = LiteLLMClient()
    with (
        patch("app.services.llm._resolve_provider_api_key", return_value="sk-test"),
        patch(
            "app.services.llm.acompletion",
            new=AsyncMock(side_effect=RateLimitError("slow down", "openrouter", "m")),
        ),
        pytest.raises(UpstreamRateLimitError),
    ):
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


@pytest.mark.asyncio
async def test_improve_text_uses_temperature_from_settings():
    mock_response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="out"))],
        model="gpt-4o-mini",
        usage=SimpleNamespace(prompt_tokens=1, completion_tokens=2, total_tokens=3),
        id="id-1",
        _hidden_params={},
    )
    with (
        patch("app.services.llm.settings.llm_temperature", 0.3),
        patch("app.services.llm._resolve_provider_api_key", return_value="sk-test"),
        patch("app.services.llm.acompletion", new_callable=AsyncMock) as ac,
    ):
        ac.return_value = mock_response
        await improve_text(
            "hello",
            request_id="req-a",
            installation_id="inst-b",
            site="example.com",
        )
    assert ac.await_args.kwargs["temperature"] == 0.3


@pytest.mark.asyncio
async def test_improve_text_retries_token_exhaustion_with_higher_budget():
    first_response = SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=""),
                finish_reason="length",
            )
        ],
        model="gpt-4o-mini",
        usage=None,
        id="id-1",
        _hidden_params={},
    )
    second_response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))],
        model="gpt-4o-mini",
        usage=None,
        id="id-2",
        _hidden_params={},
    )
    with (
        patch("app.services.llm.settings.llm_completion_tokens", 100),
        patch("app.services.llm.settings.llm_completion_tokens_retry_max", 180),
        patch("app.services.llm.settings.llm_max_retries", 2),
        patch("app.services.llm._resolve_provider_api_key", return_value="sk-test"),
        patch(
            "app.services.llm.acompletion",
            new=AsyncMock(side_effect=[first_response, second_response]),
        ) as ac,
    ):
        result = await improve_text(
            "hello",
            request_id="req-a",
            installation_id="inst-b",
            site="example.com",
        )
    assert ac.await_count == 2
    assert ac.await_args_list[0].kwargs["max_tokens"] == 100
    assert ac.await_args_list[1].kwargs["max_tokens"] == 180
    assert result.attempt_count == 2
    assert result.completion_tokens_budget_used == 180


@pytest.mark.asyncio  # SIM117 fix
async def test_improve_text_empty_completion_raises_error():
    empty_response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=""))],
        model="gpt-4o-mini",
        usage=None,
        id="id-1",
        _hidden_params={},
    )
    with (
        patch("app.services.llm.settings.llm_max_retries", 1),
        patch("app.services.llm._resolve_provider_api_key", return_value="sk-test"),
        patch("app.services.llm.acompletion", new=AsyncMock(return_value=empty_response)),
        pytest.raises(UpstreamBadResponseError),
    ):
        await improve_text(
            "hello",
            request_id="req-a",
            installation_id="inst-b",
            site="example.com",
        )


@pytest.mark.asyncio  # SIM117 fix
async def test_improve_text_too_large_completion_raises_error():
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="x" * 30))],
        model="gpt-4o-mini",
        usage=None,
        id="id-1",
        _hidden_params={},
    )
    with (
        patch("app.services.llm.settings.prompt_output_max_chars", 10),
        patch("app.services.llm._resolve_provider_api_key", return_value="sk-test"),
        patch("app.services.llm.acompletion", new=AsyncMock(return_value=response)),
        pytest.raises(UpstreamBadResponseError),
    ):
        await improve_text(
            "hello",
            request_id="req-a",
            installation_id="inst-b",
            site="example.com",
        )


@pytest.mark.asyncio  # B017 fix
async def test_improve_logs_unsupported_temperature_error(caplog):
    caplog.set_level(logging.ERROR)

    with (
        patch("app.services.llm.settings.llm_temperature", 0.8),
        patch("app.services.llm._resolve_provider_api_key", return_value="sk-test"),
        patch(
            "app.services.llm.acompletion",
            new=AsyncMock(
                side_effect=RuntimeError("temperature is not supported for model openai/o1")
            ),
        ),
        pytest.raises(UpstreamServiceError),
    ):
        await improve_text(
            "hello",
            request_id="req-a",
            installation_id="inst-b",
            site="example.com",
        )

    assert "temperature is not supported for model" in " ".join(r.message for r in caplog.records)
