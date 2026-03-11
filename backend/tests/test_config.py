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
