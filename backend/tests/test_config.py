from app.config import BotConfig, _clean_env_value


def test_clean_env_value_strips_inline_comments():
    assert _clean_env_value("OPENAI # comment") == "OPENAI"
    assert _clean_env_value(" value ") == "value"


def test_from_env_reads_openai_backend(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "OPENAI")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    config = BotConfig.from_env()

    assert config.llm_backend == "OPENAI"
    assert config.get_provider_api_key() == "sk-test"
    assert config.provider_config_error() is None


def test_provider_config_error_reports_missing_selected_key(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "OPENAI")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "unused")

    config = BotConfig.from_env()

    assert config.provider_config_error() == "OPENAI_API_KEY is required when LLM_BACKEND=OPENAI"


def test_prompt_and_completion_limits_defaults(monkeypatch):
    monkeypatch.delenv("PROMPT_INPUT_MAX_CHARS", raising=False)
    monkeypatch.delenv("PROMPT_OUTPUT_MAX_CHARS", raising=False)
    monkeypatch.delenv("LLM_COMPLETION_TOKENS", raising=False)
    monkeypatch.delenv("LLM_COMPLETION_TOKENS_RETRY_MAX", raising=False)

    config = BotConfig.from_env()

    assert config.prompt_input_max_chars == 8000
    assert config.prompt_output_max_chars == 12000
    assert config.llm_completion_tokens == 8192
    assert config.llm_completion_tokens_retry_max == 12288


def test_validate_rejects_retry_budget_lower_than_normal():
    config = BotConfig.from_env()
    config.llm_completion_tokens = 9000
    config.llm_completion_tokens_retry_max = 8000

    try:
        config.validate()
    except ValueError as exc:
        assert "LLM_COMPLETION_TOKENS_RETRY_MAX must be greater than or equal" in str(exc)
    else:
        raise AssertionError("Expected ValueError")


def test_validate_rejects_empty_installation_id_salt():
    config = BotConfig.from_env()
    config.installation_id_salt = ""

    try:
        config.validate()
    except ValueError as exc:
        assert str(exc) == "INSTALLATION_ID_SALT must not be empty"
    else:
        raise AssertionError("Expected ValueError")


def test_validate_rejects_empty_ip_salt():
    config = BotConfig.from_env()
    config.ip_salt = ""

    try:
        config.validate()
    except ValueError as exc:
        assert str(exc) == "IP_SALT must not be empty"
    else:
        raise AssertionError("Expected ValueError")
