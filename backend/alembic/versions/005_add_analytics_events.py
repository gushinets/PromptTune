"""Add analytics_events table

Revision ID: 005
Revises: 004
Create Date: 2026-05-15
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "005"
down_revision: str | None = "004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "analytics_events",
        sa.Column("event_id", sa.String(36), primary_key=True),
        sa.Column("event_name", sa.String(64), nullable=False),
        sa.Column("user_id", sa.String(64), nullable=False),
        sa.Column("session_id", sa.String(64), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("extension_version", sa.String(64), nullable=True),
        sa.Column("os", sa.String(32), nullable=True),
        sa.Column("chrome_version", sa.String(128), nullable=True),
        sa.Column("user_plan", sa.String(32), nullable=True),
        sa.Column("source", sa.String(32), nullable=True),
        sa.Column("properties", sa.JSON(), nullable=True),
    )

    op.create_index(
        "ix_analytics_events_event_name_occurred",
        "analytics_events",
        ["event_name", "occurred_at"],
    )
    op.create_index(
        "ix_analytics_events_user_occurred",
        "analytics_events",
        ["user_id", "occurred_at"],
    )
    op.create_index(
        "ix_analytics_events_user_event_occurred",
        "analytics_events",
        ["user_id", "event_name", "occurred_at"],
    )
    op.create_index(
        "ix_analytics_events_session_occurred",
        "analytics_events",
        ["session_id", "occurred_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_analytics_events_session_occurred", table_name="analytics_events")
    op.drop_index("ix_analytics_events_user_event_occurred", table_name="analytics_events")
    op.drop_index("ix_analytics_events_user_occurred", table_name="analytics_events")
    op.drop_index("ix_analytics_events_event_name_occurred", table_name="analytics_events")
    op.drop_table("analytics_events")
