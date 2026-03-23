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
    max_text_length: int
    allowed_origins: str
    llm_request_timeout_seconds: float
    openrouter_site_url: str | None
    openrouter_app_name: str | None
    logs_dir: str
    log_file: str
    log_max_size: int
    log_backup_count: int
    installation_id_salt: str
    ip_salt: str

    @classmethod
    def from_env(cls) -> "BotConfig":
        """Load configuration from environment variables."""
        llm_backend = (_get_env("LLM_BACKEND", "OPENROUTER") or "OPENROUTER").upper()
        llm_model = _get_env("LLM_MODEL", "gpt-4o-mini") or "gpt-4o-mini"
        logs_dir = _get_env("LOGS_DIR", str(BACKEND_ROOT / "logs"))
        log_file = _get_env("LOG_FILE", "access.log")
        log_max_size = _get_int_env("LOG_MAX_SIZE", 10 * 1024 * 1024)  # 10 MB
        log_backup_count = _get_int_env("LOG_BACKUP_COUNT", 5)


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
            max_text_length=_get_int_env("MAX_TEXT_LENGTH", 8000),
            allowed_origins=_get_env("ALLOWED_ORIGINS", "*") or "*",
            llm_request_timeout_seconds=_get_float_env("LLM_REQUEST_TIMEOUT_SECONDS", 60.0),
            openrouter_site_url=_get_env("OPENROUTER_SITE_URL"),
            openrouter_app_name=_get_env("OPENROUTER_APP_NAME"),
            logs_dir=logs_dir,
            log_file=log_file,
            log_max_size=log_max_size,
            log_backup_count=log_backup_count,
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
        if self.max_text_length <= 0:
            raise ValueError(
                f"MAX_TEXT_LENGTH must be positive. Got: {self.max_text_length}"
            )
        if self.log_max_size <= 0:
            raise ValueError(
                f"LOG_MAX_SIZE must be positive. Got: {self.log_max_size}"
            )
        if self.log_backup_count < 0:
            raise ValueError(
                f"LOG_BACKUP_COUNT must be non-negative. Got: {self.log_backup_count}"
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
