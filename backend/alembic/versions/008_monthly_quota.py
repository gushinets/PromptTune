"""Durable monthly quota, generation reservations and verified email claims.

Revision ID: 008
Revises: 007
"""

import sqlalchemy as sa

from alembic import op

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "improvement_quotas",
        sa.Column("installation_id", sa.String(64), primary_key=True),
        sa.Column("anchor_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("next_reset_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("remaining", sa.Integer(), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("bonus_claimed", sa.Boolean(), nullable=False),
        sa.Column("email", sa.String(254)),
        sa.Column("email_verified", sa.Boolean(), nullable=False),
        sa.Column("challenge_digest", sa.String(64)),
        sa.Column("challenge_expires_at", sa.DateTime(timezone=True)),
        sa.Column("challenge_sent_at", sa.DateTime(timezone=True)),
        sa.Column("challenge_attempts", sa.Integer(), nullable=False),
    )
    op.create_table(
        "email_bonus_claims",
        sa.Column("email", sa.String(254), primary_key=True),
        sa.Column("installation_id", sa.String(64), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "quota_reservations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("installation_id", sa.String(64), nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
    )
    op.create_index(
        "ix_quota_reservations_installation_status",
        "quota_reservations",
        ["installation_id", "status"],
    )


def downgrade():
    op.drop_table("quota_reservations")
    op.drop_table("email_bonus_claims")
    op.drop_table("improvement_quotas")
