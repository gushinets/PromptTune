import logging
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from litellm.exceptions import AuthenticationError, RateLimitError

from app.services.errors import (
    UpstreamAuthError,
    UpstreamBadResponseError,
    UpstreamRateLimitError,
    UpstreamServiceError,
    UpstreamTimeoutError,
)
from app.services.llm import (
    SYSTEM_PROMPT,
    LiteLLMClient,
    _choice_finish_reason,
    _empty_completion_detail,
    _empty_completion_diagnostics,
    _infer_provider_from_model,
    _map_litellm_error,
    _normalize_response,
    _provider_from_response,
    _resolve_model_name,
    _resolve_provider_api_key,
    _should_retry_empty_completion,
    _usage_tokens,
    improve_text,
    logger as llm_logger,
    setup_file_logging,
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


def test_setup_file_logging_is_idempotent():
    original_handlers = list(llm_logger.handlers)
    try:
        llm_logger.handlers = []
        setup_file_logging()
        first_count = len(llm_logger.handlers)
        setup_file_logging()
        second_count = len(llm_logger.handlers)
        assert first_count == 1
        assert second_count == 1
        assert getattr(llm_logger.handlers[0], "stream", None) is sys.stdout
    finally:
        llm_logger.handlers = original_handlers


def test_choice_finish_reason_with_no_choices_and_dict_choice():
    assert _choice_finish_reason(SimpleNamespace(choices=[])) is None
    assert _choice_finish_reason(SimpleNamespace(choices=[{"finish_reason": "length"}])) == "length"


def test_empty_completion_detail_non_length_reason():
    response = SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop")])
    assert _empty_completion_detail(response) == "empty_completion"


def test_empty_completion_diagnostics_includes_finish_reason():
    response = SimpleNamespace(choices=[SimpleNamespace(finish_reason="length")])
    assert _empty_completion_diagnostics(response) == {"finish_reason": "length"}


def test_should_retry_empty_completion_attempt_bounds():
    assert _should_retry_empty_completion("empty_completion", 2, 2) is False
    assert _should_retry_empty_completion("empty_completion", 2, 5) is False
    assert _should_retry_empty_completion("empty_completion", 1, 5) is True


def test_resolve_model_name_falls_back_to_model_id():
    response = SimpleNamespace(model=" ")
    assert _resolve_model_name(response, "openrouter/m") == "openrouter/m"


def test_resolve_provider_api_key_missing_openai():
    with patch("app.services.llm.settings.get_provider_api_key", return_value=None), patch(
        "app.services.llm.settings.llm_backend", "OPENAI"
    ), pytest.raises(UpstreamAuthError, match="OpenAI API key"):
        _resolve_provider_api_key()


def test_resolve_provider_api_key_missing_openrouter():
    with patch("app.services.llm.settings.get_provider_api_key", return_value=None), patch(
        "app.services.llm.settings.llm_backend", "OPENROUTER"
    ), pytest.raises(UpstreamAuthError, match="OpenRouter API key"):
        _resolve_provider_api_key()


def test_infer_provider_from_model_variants():
    assert _infer_provider_from_model("openrouter/gpt-4o-mini") == "openrouter"
    assert _infer_provider_from_model("gpt-4o-mini") is None


def test_usage_tokens_with_dict_and_missing_usage():
    response_with_dict = SimpleNamespace(
        usage={"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}
    )
    assert _usage_tokens(response_with_dict) == (1, 2, 3)
    assert _usage_tokens(SimpleNamespace(usage=None)) == (None, None, None)


def test_provider_from_response_uses_hidden_params():
    assert (
        _provider_from_response(
            SimpleNamespace(_hidden_params={"custom_llm_provider": "OpenRouter"}),
            "openrouter/model",
        )
        == "openrouter"
    )
    assert (
        _provider_from_response(
            SimpleNamespace(_hidden_params={"litellm_provider": "OpenAI"}),
            "openai/model",
        )
        == "openai"
    )
    assert (
        _provider_from_response(
            SimpleNamespace(_hidden_params={"api_base": "HTTPS://example.com"}),
            "openai/model",
        )
        == "https://example.com"
    )


def test_map_litellm_error_timeout_and_connection():
    with patch("app.services.llm.LitellmTimeout", RuntimeError):
        mapped = _map_litellm_error(RuntimeError("timed out"))
        assert isinstance(mapped, UpstreamTimeoutError)

    class _ConnError(Exception):
        pass

    with patch("app.services.llm.APIConnectionError", _ConnError):
        mapped = _map_litellm_error(_ConnError("dial failed"))
        assert isinstance(mapped, UpstreamServiceError)
        assert "dial failed" in str(mapped)


def test_map_litellm_error_openai_status_branches():
    class _OpenAIErr(Exception):
        def __init__(self, status_code, message="oops"):
            super().__init__(message)
            self.status_code = status_code
            self.message = message

    with patch("app.services.llm.OpenAIError", _OpenAIErr):
        assert isinstance(_map_litellm_error(_OpenAIErr(401)), UpstreamAuthError)
        assert isinstance(_map_litellm_error(_OpenAIErr(403)), UpstreamAuthError)
        assert isinstance(_map_litellm_error(_OpenAIErr(429)), UpstreamRateLimitError)
        other = _map_litellm_error(_OpenAIErr(500, "server boom"))
        assert isinstance(other, UpstreamServiceError)
        assert "500" in str(other)


def test_map_litellm_error_specific_classes():
    class _BadReq(Exception):
        pass

    class _NotFound(Exception):
        pass

    class _Ctx(Exception):
        pass

    class _Policy(Exception):
        pass

    class _Internal(Exception):
        pass

    class _ApiErr(Exception):
        pass

    with (
        patch("app.services.llm.BadRequestError", _BadReq),
        patch("app.services.llm.NotFoundError", _NotFound),
        patch("app.services.llm.ContextWindowExceededError", _Ctx),
        patch("app.services.llm.ContentPolicyViolationError", _Policy),
        patch("app.services.llm.InternalServerError", _Internal),
        patch("app.services.llm.APIError", _ApiErr),
    ):
        assert isinstance(_map_litellm_error(_BadReq("bad request")), UpstreamServiceError)
        assert isinstance(_map_litellm_error(_NotFound("missing")), UpstreamServiceError)
        assert isinstance(_map_litellm_error(_Ctx("window")), UpstreamServiceError)
        assert isinstance(_map_litellm_error(_Policy("policy")), UpstreamServiceError)
        assert isinstance(_map_litellm_error(_Internal("internal")), UpstreamServiceError)
        assert isinstance(_map_litellm_error(_ApiErr("api")), UpstreamServiceError)


@pytest.mark.asyncio
async def test_improve_text_openrouter_extra_headers():
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))],
        model="openrouter/model",
        usage=None,
        id="id-1",
        _hidden_params={},
    )
    with (
        patch("app.services.llm.settings.llm_backend", "OPENROUTER"),
        patch("app.services.llm.settings.openrouter_site_url", "https://site.example"),
        patch("app.services.llm.settings.openrouter_app_name", "PromptTuneTest"),
        patch("app.services.llm._resolve_provider_api_key", return_value="sk"),
        patch("app.services.llm.acompletion", new=AsyncMock(return_value=response)) as ac,
    ):
        await improve_text("hello", request_id="r1", installation_id="i1", site="s1")
    assert ac.await_args.kwargs["extra_headers"] == {
        "HTTP-Referer": "https://site.example",
        "X-Title": "PromptTuneTest",
    }


@pytest.mark.asyncio
async def test_improve_text_missing_choices_raises():
    response = SimpleNamespace(choices=[], model="m", usage=None, id="id", _hidden_params={})
    with (
        patch("app.services.llm._resolve_provider_api_key", return_value="sk"),
        patch("app.services.llm.acompletion", new=AsyncMock(return_value=response)),
        pytest.raises(UpstreamBadResponseError, match="no choices"),
    ):
        await improve_text("hello", request_id="r1", installation_id="i1", site="s1")


@pytest.mark.asyncio
async def test_improve_text_missing_message_content_raises():
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace())],
        model="m",
        usage=None,
        id="id",
        _hidden_params={},
    )
    with (
        patch("app.services.llm._resolve_provider_api_key", return_value="sk"),
        patch("app.services.llm.acompletion", new=AsyncMock(return_value=response)),
        pytest.raises(UpstreamBadResponseError, match="missing message content"),
    ):
        await improve_text("hello", request_id="r1", installation_id="i1", site="s1")


@pytest.mark.asyncio
async def test_improve_text_non_string_message_content_raises():
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=123))],
        model="m",
        usage=None,
        id="id",
        _hidden_params={},
    )
    with (
        patch("app.services.llm._resolve_provider_api_key", return_value="sk"),
        patch("app.services.llm.acompletion", new=AsyncMock(return_value=response)),
        pytest.raises(UpstreamBadResponseError, match="must be a string"),
    ):
        await improve_text("hello", request_id="r1", installation_id="i1", site="s1")


@pytest.mark.asyncio
async def test_improve_text_empty_completion_non_token_exhaustion_no_retry_when_attempt_above_limit():
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=""), finish_reason="stop")],
        model="m",
        usage=None,
        id="id",
        _hidden_params={},
    )
    with (
        patch("app.services.llm.settings.llm_max_retries", 2),
        patch("app.services.llm._resolve_provider_api_key", return_value="sk"),
        patch("app.services.llm.acompletion", new=AsyncMock(return_value=response)) as ac,
        pytest.raises(UpstreamBadResponseError, match="empty completion"),
    ):
        await improve_text("hello", request_id="r1", installation_id="i1", site="s1")
    assert ac.await_count == 2


@pytest.mark.asyncio
async def test_improve_text_provider_inference_from_model_fallback():
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))],
        model="",
        usage=None,
        id="id-2",
        _hidden_params={},
    )
    with (
        patch("app.services.llm.settings.litellm_model_id", return_value="openai/gpt-4o-mini"),
        patch("app.services.llm._resolve_provider_api_key", return_value="sk"),
        patch("app.services.llm.acompletion", new=AsyncMock(return_value=response)),
    ):
        result = await improve_text("hello", request_id="r1", installation_id="i1", site="s1")
    assert result.provider == "openai"
