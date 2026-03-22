"""Initial schema: installations + prompt_improvements

Revision ID: 001
Revises:
Create Date: 2026-03-06
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "installations",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column("first_user_agent", sa.String(512), nullable=True),
        sa.Column("first_ip", sa.String(45), nullable=True),
    )

    op.create_table(
        "prompt_improvements",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("installation_id", sa.String(64), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("site", sa.String(128), nullable=True),
        sa.Column("page_url", sa.String(2048), nullable=True),
        sa.Column("original_text", sa.Text, nullable=False),
        sa.Column("improved_text", sa.Text, nullable=False),
        sa.Column("model", sa.String(128), nullable=True),
        sa.Column("latency_ms", sa.Integer, nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="ok"),
        sa.Column("error", sa.Text, nullable=True),
    )

    op.create_index(
        "ix_prompt_improvements_installation_created",
        "prompt_improvements",
        ["installation_id", "created_at"],
    )
    op.create_index(
        "ix_prompt_improvements_created",
        "prompt_improvements",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_table("prompt_improvements")
    op.drop_table("installations")
