import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
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


class AnalyticsEvent(Base):
    __tablename__ = "analytics_events"
    __table_args__ = (
        Index("ix_analytics_events_event_name_occurred", "event_name", "occurred_at"),
        Index("ix_analytics_events_user_occurred", "user_id", "occurred_at"),
        Index("ix_analytics_events_user_event_occurred", "user_id", "event_name", "occurred_at"),
        Index("ix_analytics_events_session_occurred", "session_id", "occurred_at"),
    )

    event_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_name: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    session_id: Mapped[str | None] = mapped_column(String(64), index=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    extension_version: Mapped[str | None] = mapped_column(String(64))
    os: Mapped[str | None] = mapped_column(String(32))
    chrome_version: Mapped[str | None] = mapped_column(String(128))
    user_plan: Mapped[str | None] = mapped_column(String(32))
    source: Mapped[str | None] = mapped_column(String(32))
    properties: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class ImprovementQuota(Base):
    __tablename__ = "improvement_quotas"

    installation_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    anchor_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    next_reset_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    remaining: Mapped[int] = mapped_column(Integer, default=50)
    total: Mapped[int] = mapped_column(Integer, default=50)
    bonus_claimed: Mapped[bool] = mapped_column(default=False)
    email: Mapped[str | None] = mapped_column(String(254))
    email_verified: Mapped[bool] = mapped_column(default=False)
    challenge_digest: Mapped[str | None] = mapped_column(String(64))
    challenge_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    challenge_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    challenge_attempts: Mapped[int] = mapped_column(Integer, default=0)


class EmailBonusClaim(Base):
    __tablename__ = "email_bonus_claims"

    email: Mapped[str] = mapped_column(String(254), primary_key=True)
    installation_id: Mapped[str] = mapped_column(String(64))
    claimed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class QuotaReservation(Base):
    __tablename__ = "quota_reservations"
    __table_args__ = (
        Index("ix_quota_reservations_installation_status", "installation_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    installation_id: Mapped[str] = mapped_column(String(64))
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default="pending")
