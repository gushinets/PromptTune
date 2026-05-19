"""Add standalone occurred_at index for analytics retention cleanup

Revision ID: 006
Revises: 005
Create Date: 2026-05-18
"""

from collections.abc import Sequence

from alembic import op

revision: str = "006"
down_revision: str | None = "005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


INDEX_NAME = "ix_analytics_events_occurred_at"
TABLE_NAME = "analytics_events"


def upgrade() -> None:
    op.create_index(INDEX_NAME, TABLE_NAME, ["occurred_at"])


def downgrade() -> None:
    op.drop_index(INDEX_NAME, table_name=TABLE_NAME)
