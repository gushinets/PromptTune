import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = BACKEND_ROOT / ".env"


def _load_env() -> None:
    env_files: list[Path] = [DEFAULT_ENV_FILE]

    seen: set[Path] = set()
    for env_file in env_files:
        resolved = env_file.expanduser().resolve()
        if resolved in seen or not resolved.exists():
            continue
        load_dotenv(resolved, override=False)
        seen.add(resolved)


def _clean_env_value(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if " #" in cleaned:
        cleaned = cleaned.split(" #", 1)[0].rstrip()
    return cleaned


def _get_env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None:
        return default
    cleaned = _clean_env_value(value)
    if cleaned == "":
        return default
    return cleaned


def _get_int_env(name: str, default: int) -> int:
    value = _get_env(name)
    if value is None:
        return default
    return int(value)


def _get_float_env(name: str, default: float) -> float:
    value = _get_env(name)
    if value is None:
        return default
    return float(value)


def _get_optional_float_env(name: str) -> float | None:
    value = _get_env(name)
    if value is None:
        return None
    return float(value)


_load_env()


@dataclass
class BotConfig:
    """Configuration for PromptTune application."""

    database_url: str
    redis_url: str
    llm_backend: str
    llm_model: str
    openai_api_key: str | None
    openrouter_api_key: str | None
    free_req_per_day: int
    free_req_per_min: int
    prompt_input_max_chars: int
    prompt_output_max_chars: int
    llm_completion_tokens: int
    llm_completion_tokens_retry_max: int
    llm_max_retries: int
    llm_temperature: float | None
    allowed_origins: str
    llm_request_timeout_seconds: float
    openrouter_site_url: str | None
    openrouter_app_name: str | None
    installation_id_salt: str
    ip_salt: str

    @classmethod
    def from_env(cls) -> "BotConfig":
        """Load configuration from environment variables."""
        llm_backend = (_get_env("LLM_BACKEND", "OPENROUTER") or "OPENROUTER").upper()
        llm_model = _get_env("LLM_MODEL", "gpt-4o-mini") or "gpt-4o-mini"

        return cls(
            database_url=_get_env(
                "DATABASE_URL",
                "postgresql+asyncpg://prompttune:prompttune@localhost:5432/prompttune",
            )
            or "postgresql+asyncpg://prompttune:prompttune@localhost:5432/prompttune",
            redis_url=_get_env("REDIS_URL", "redis://localhost:6379/0")
            or "redis://localhost:6379/0",
            llm_backend=llm_backend,
            llm_model=llm_model,
            openai_api_key=_get_env("OPENAI_API_KEY"),
            openrouter_api_key=_get_env("OPENROUTER_API_KEY"),
            free_req_per_day=_get_int_env("FREE_REQ_PER_DAY", 50),
            free_req_per_min=_get_int_env("FREE_REQ_PER_MIN", 10),
            prompt_input_max_chars=_get_int_env("PROMPT_INPUT_MAX_CHARS", 8000),
            prompt_output_max_chars=_get_int_env("PROMPT_OUTPUT_MAX_CHARS", 12000),
            llm_completion_tokens=_get_int_env("LLM_COMPLETION_TOKENS", 8192),
            llm_completion_tokens_retry_max=_get_int_env("LLM_COMPLETION_TOKENS_RETRY_MAX", 12288),
            llm_max_retries=_get_int_env("LLM_MAX_RETRIES", 2),
            llm_temperature=_get_optional_float_env("LLM_TEMPERATURE"),
            allowed_origins=_get_env("ALLOWED_ORIGINS", "*") or "*",
            llm_request_timeout_seconds=_get_float_env("LLM_REQUEST_TIMEOUT_SECONDS", 60.0),
            openrouter_site_url=_get_env("OPENROUTER_SITE_URL"),
            openrouter_app_name=_get_env("OPENROUTER_APP_NAME"),
            installation_id_salt=_get_env("INSTALLATION_ID_SALT", "prompttune-installation")
            or "prompttune-installation",
            ip_salt=_get_env("IP_SALT", "prompttune-ip") or "prompttune-ip",
        )

    def validate(self) -> None:
        """Validate configuration consistency and business rules."""
        if self.llm_backend not in ("OPENAI", "OPENROUTER"):
            raise ValueError(
                f"LLM_BACKEND must be one of: OPENAI, OPENROUTER. Got: {self.llm_backend}"
            )

        if self.free_req_per_day <= 0:
            raise ValueError(f"FREE_REQ_PER_DAY must be positive. Got: {self.free_req_per_day}")
        if self.free_req_per_min <= 0:
            raise ValueError(f"FREE_REQ_PER_MIN must be positive. Got: {self.free_req_per_min}")
        if self.prompt_input_max_chars <= 0:
            raise ValueError(
                f"PROMPT_INPUT_MAX_CHARS must be positive. Got: {self.prompt_input_max_chars}"
            )
        if self.prompt_output_max_chars <= 0:
            raise ValueError(
                f"PROMPT_OUTPUT_MAX_CHARS must be positive. Got: {self.prompt_output_max_chars}"
            )
        if self.llm_completion_tokens <= 0:
            raise ValueError(
                f"LLM_COMPLETION_TOKENS must be positive. Got: {self.llm_completion_tokens}"
            )
        if self.llm_completion_tokens_retry_max <= 0:
            raise ValueError(
                "LLM_COMPLETION_TOKENS_RETRY_MAX must be positive. "
                f"Got: {self.llm_completion_tokens_retry_max}"
            )
        if self.llm_completion_tokens_retry_max < self.llm_completion_tokens:
            raise ValueError(
                "LLM_COMPLETION_TOKENS_RETRY_MAX must be greater than or equal to "
                f"LLM_COMPLETION_TOKENS. Got: {self.llm_completion_tokens_retry_max} < "
                f"{self.llm_completion_tokens}"
            )
        if self.llm_max_retries <= 0:
            raise ValueError(f"LLM_MAX_RETRIES must be positive. Got: {self.llm_max_retries}")
        if self.llm_temperature is not None and not (0 <= self.llm_temperature <= 2):
            raise ValueError(
                f"LLM_TEMPERATURE must be in range [0, 2]. Got: {self.llm_temperature}"
            )
        if self.llm_request_timeout_seconds <= 0:
            raise ValueError(
                "LLM_REQUEST_TIMEOUT_SECONDS must be positive. "
                f"Got: {self.llm_request_timeout_seconds}"
            )

    def litellm_model_id(self) -> str:
        """Model string passed to LiteLLM (provider-prefixed)."""
        if self.llm_backend == "OPENAI":
            if "/" not in self.llm_model:
                return f"openai/{self.llm_model}"
            return self.llm_model
        if self.llm_model.startswith("openrouter/"):
            return self.llm_model
        if "/" not in self.llm_model:
            return f"openrouter/openai/{self.llm_model}"
        return f"openrouter/{self.llm_model}"
        if not self.installation_id_salt:
            raise ValueError("INSTALLATION_ID_SALT must not be empty")
        if not self.ip_salt:
            raise ValueError("IP_SALT must not be empty")

    def get_provider_api_key(self) -> str | None:
        if self.llm_backend == "OPENAI":
            return self.openai_api_key
        if self.llm_backend == "OPENROUTER":
            return self.openrouter_api_key
        return None

    def provider_config_error(self) -> str | None:
        if self.llm_backend == "OPENAI" and not self.openai_api_key:
            return "OPENAI_API_KEY is required when LLM_BACKEND=OPENAI"
        if self.llm_backend == "OPENROUTER" and not self.openrouter_api_key:
            return "OPENROUTER_API_KEY is required when LLM_BACKEND=OPENROUTER"
        return None

    @property
    def allowed_origins_list(self) -> list[str]:
        if self.allowed_origins.strip() == "*":
            return ["*"]
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


def _apply_openrouter_litellm_env(cfg: BotConfig) -> None:
    """LiteLLM OpenRouter integration reads OR_SITE_URL / OR_APP_NAME from the environment."""
    if cfg.llm_backend != "OPENROUTER":
        return
    os.environ["OR_SITE_URL"] = cfg.openrouter_site_url or "https://prompttune.local"
    os.environ["OR_APP_NAME"] = cfg.openrouter_app_name or "PromptTune"


settings = BotConfig.from_env()
settings.validate()
_apply_openrouter_litellm_env(settings)
