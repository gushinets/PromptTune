import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Installation(Base):
    __tablename__ = "installations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    first_user_agent: Mapped[str | None] = mapped_column(String(512))
    first_ip: Mapped[str | None] = mapped_column(String(45))


class PromptImprovement(Base):
    __tablename__ = "prompt_improvements"
    __table_args__ = (
        Index("ix_prompt_improvements_installation_created", "installation_id", "created_at"),
        Index("ix_prompt_improvements_created", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    installation_id: Mapped[str] = mapped_column(String(64), index=True)
    client: Mapped[str | None] = mapped_column(String(64))
    client_version: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    site: Mapped[str | None] = mapped_column(String(128))
    page_url: Mapped[str | None] = mapped_column(String(2048))
    original_text: Mapped[str] = mapped_column(Text)
    improved_text: Mapped[str] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(String(128))
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    llm_meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="ok")
    error: Mapped[str | None] = mapped_column(Text)
