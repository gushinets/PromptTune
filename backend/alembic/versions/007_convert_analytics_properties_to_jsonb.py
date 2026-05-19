"""Convert analytics_events.properties to JSONB

Revision ID: 007
Revises: 006
Create Date: 2026-05-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "007"
down_revision: str | None = "006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "analytics_events",
        "properties",
        existing_type=sa.JSON(),
        type_=postgresql.JSONB(astext_type=sa.Text()),
        postgresql_using="properties::jsonb",
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "analytics_events",
        "properties",
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        type_=sa.JSON(),
        postgresql_using="properties::json",
        existing_nullable=True,
    )
