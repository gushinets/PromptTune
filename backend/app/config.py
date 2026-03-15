from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://prompttune:prompttune@localhost:5432/prompttune"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # LLM
    llm_model: str = "gpt-4o-mini"

    # Rate limits
    free_req_per_day: int = 50
    free_req_per_min: int = 10

    # Security
    max_text_length: int = 8000
    allowed_origins: str = "*"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
