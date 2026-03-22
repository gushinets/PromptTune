"""Add client metadata columns to prompt_improvements

Revision ID: 002
Revises: 001
Create Date: 2026-03-10
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "002"
down_revision: str | None = "001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("prompt_improvements", sa.Column("client", sa.String(64), nullable=True))
    op.add_column("prompt_improvements", sa.Column("client_version", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("prompt_improvements", "client_version")
    op.drop_column("prompt_improvements", "client")
