"""Add llm_meta JSON to prompt_improvements

Revision ID: 003
Revises: 002
Create Date: 2026-03-19
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("prompt_improvements", sa.Column("llm_meta", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("prompt_improvements", "llm_meta")
