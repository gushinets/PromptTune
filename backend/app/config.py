import os
from dataclasses import dataclass, field
from typing import Optional

from dotenv import load_dotenv


load_dotenv()


@dataclass
class BotConfig:
    """Configuration for PromptTune application."""

    # Database
    database_url: str = field(
        default=os.getenv(
            "DATABASE_URL",
            "postgresql+asyncpg://prompttune:prompttune@localhost:5432/prompttune"
        )
    )

    # Redis
    redis_url: str = field(
        default=os.getenv(
            "REDIS_URL",
            "redis://localhost:6379/0"
        )
    )

    # LLM
    llm_backend: str = field(
        default=os.getenv("LLM_BACKEND", "OPENROUTER").upper()
    )
    llm_model: str = field(
        default=os.getenv("LLM_MODEL", "gpt-4o-mini")
    )
    openai_api_key: Optional[str] = field(
        default=os.getenv("OPENAI_API_KEY")
    )
    openrouter_api_key: Optional[str] = field(
        default=os.getenv("OPENROUTER_API_KEY")
    )

    # Rate limits
    free_req_per_day: int = field(
        default=int(os.getenv("FREE_REQ_PER_DAY", "50"))
    )
    free_req_per_min: int = field(
        default=int(os.getenv("FREE_REQ_PER_MIN", "10"))
    )

    # Security
    max_text_length: int = field(
        default=int(os.getenv("MAX_TEXT_LENGTH", "8000"))
    )
    allowed_origins: str = field(
        default=os.getenv("ALLOWED_ORIGINS", "*")
    )

    @classmethod
    def from_env(cls) -> "BotConfig":
        """Load configuration from environment variables."""
        return cls()

    def validate(self) -> None:
        """Validate configuration consistency and business rules."""
        if self.llm_backend not in ("OPENAI", "OPENROUTER"):
            raise ValueError(
                f"LLM_BACKEND must be one of: OPENAI, OPENROUTER. Got: {self.llm_backend}"
            )
        if self.llm_backend == "OPENAI" and not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY is required when LLM_BACKEND=OPENAI")
        if self.llm_backend == "OPENROUTER" and not self.openrouter_api_key:
            raise ValueError("OPENROUTER_API_KEY is required when LLM_BACKEND=OPENROUTER")

        if self.free_req_per_day <= 0:
            raise ValueError(
                f"FREE_REQ_PER_DAY must be positive. Got: {self.free_req_per_day}"
            )
        if self.free_req_per_min <= 0:
            raise ValueError(
                f"FREE_REQ_PER_MIN must be positive. Got: {self.free_req_per_min}"
            )
        if self.max_text_length <= 0:
            raise ValueError(
                f"MAX_TEXT_LENGTH must be positive. Got: {self.max_text_length}"
            )


settings = BotConfig.from_env()
settings.validate()
