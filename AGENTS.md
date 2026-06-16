# Agent Checks

Use `python scripts/agent/quick_check.py` from the repo root as the canonical backend baseline check.

What it runs by default:
- Alembic migration preflight against `DATABASE_URL`
- Config validation via `backend/tests/test_config.py`
- Architecture validation via `backend/tests/test_infra_coverage.py`
- Remaining backend pytest suite

Optional modes:
- `python scripts/agent/quick_check.py --frontend` adds `extension` lint and tests
- `python scripts/agent/quick_check.py --no-db-migrate` skips the migration preflight for faster iteration

Environment expectations:
- Use Python 3.12+
- Install backend deps with `python -m pip install -e "./backend[dev]"` so the checks run against the same interpreter environment
- `quick_check.py` defaults `DATABASE_URL` to `postgresql+asyncpg://prompttune:prompttune@localhost:5432/prompttune_test` and `REDIS_URL` to `redis://localhost:6379/0`; override them only when you intentionally want another test environment
