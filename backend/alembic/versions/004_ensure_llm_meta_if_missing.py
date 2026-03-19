"""Ensure llm_meta column exists on prompt_improvements

In some environments `alembic_version` may indicate the expected revision,
but the column itself may still be missing. This migration makes the schema
idempotent by adding the column only if it doesn't exist.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE prompt_improvements "
        "ADD COLUMN IF NOT EXISTS llm_meta JSON"
    )


def downgrade() -> None:
    # Best-effort rollback; in practice you likely won't downgrade this.
    op.execute("ALTER TABLE prompt_improvements DROP COLUMN IF EXISTS llm_meta")
