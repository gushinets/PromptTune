import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = BACKEND_ROOT / ".env"
ENV_FILE_OVERRIDE = os.getenv("PROMPTTUNE_ENV_FILE")


def _load_env() -> None:
    env_files: list[Path] = []
    if ENV_FILE_OVERRIDE:
        env_files.append(Path(ENV_FILE_OVERRIDE))
    env_files.append(DEFAULT_ENV_FILE)

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
            max_text_length=_get_int_env("MAX_TEXT_LENGTH", 8000),
            allowed_origins=_get_env("ALLOWED_ORIGINS", "*") or "*",
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
            raise ValueError(f"MAX_TEXT_LENGTH must be positive. Got: {self.max_text_length}")

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


settings = BotConfig.from_env()
settings.validate()
