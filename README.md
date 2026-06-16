# PromptTune

Browser extension for AI prompt improvement. Supports Chrome, Edge, and Firefox.

## Project Structure

- **extension/** — WXT + TypeScript + React browser extension
- **backend/** — FastAPI + LiteLLM + PostgreSQL + Redis
- **infra/** — Docker Compose configs, Caddy reverse proxy
- **docs/** — Project documentation
  - Metrics runbook: `docs/metrics.md`

## Quick Start

### Extension

```bash
cd extension
npm install
npm run dev        # WXT dev mode (Chrome)
npm run build      # Production build
```

#### Local backend profile (safe, without touching prod settings)

Use dedicated scripts that force localhost for this terminal run only:

```bash
cd extension
npm run dev:local-api
```

Also available:
- `npm run dev:local-api:firefox`
- `npm run build:local-api`
- `npm run zip:local-api`

Optional persistent local override (git-ignored):

```bash
cd extension
cp .env.local.example .env.local
```

This does not overwrite production values in code or CI.

#### Run extension tests

```bash
cd extension
npm install
npm run test           # Fast test run
npm run test:coverage  # Coverage report in extension/coverage/
```

#### Build shareable zip files

```bash
cd extension
npm install
npm run zip          # Chrome / Edge package
npm run zip:firefox  # Firefox package
```

Generated files:

- `extension/.output/prompttune-extension-0.1.0-chrome.zip`
- `extension/.output/prompttune-extension-0.1.0-firefox.zip`
- `extension/.output/prompttune-extension-0.1.0-sources.zip` (generated with the Firefox build)

Notes:
- `npm run zip` builds the Chrome Manifest V3 package used by Chrome and Edge.
- If you need the extension to point at a non-default backend, set the relevant `VITE_*` env vars before running the zip command.

### Backend

The extension supports two backends, controlled by the `VITE_BACKEND_MODE` env var:

| Mode | Description | Default target |
|------|-------------|----------------|
| `fastapi` | Calls the live FastAPI backend | `https://api.anytoolai.store/v1/improve` |
| `n8n` | Calls an n8n webhook override | `http://localhost:5678/webhook/improve-prompt` |

#### FastAPI (default)

The extension now defaults to the production backend:

```
VITE_BACKEND_MODE=fastapi
VITE_API_BASE_URL=https://api.anytoolai.store
```

To point the extension at a local FastAPI instance instead, override:

```bash
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
python -m pip install -e "./backend[dev]"  # use the same interpreter for install + checks
cd backend
python -m uvicorn app.main:app --reload
```

Backend dependency policy and validation:
- Use `backend/pyproject.toml` as the single source of truth for Python dependencies.
- Do not maintain `backend/requirements.in` or `backend/requirements.txt`.
- From the repo root, run:
  - `python -m pip install -e "./backend[dev]"` (dev/test/lint; use the same interpreter you will run checks with)
  - `python scripts/agent/quick_check.py` for the canonical backend baseline
- Additional backend-only commands from `backend/`:
  - `python -m pip install -e .` (runtime)
  - `python -m pip install -e ".[dev]"` (dev/test/lint)
  - `ruff check .`
  - `ruff format --check .`
- One-time sanity check:
  - `python -m pip install -e "./backend[dev]"`
  - `python -c "from importlib.metadata import version; print(version('litellm'))"` (expected: `1.82.2`)

Baseline command details:
- `python scripts/agent/quick_check.py` runs:
  - Alembic migration preflight against `DATABASE_URL`
  - config validation via `backend/tests/test_config.py`
  - architecture validation via `backend/tests/test_infra_coverage.py`
  - the remaining backend pytest suite
- `python scripts/agent/quick_check.py --frontend` additionally runs optional extension checks (`npm run lint` and `npm run test`)
- `python scripts/agent/quick_check.py --no-db-migrate` skips the migration preflight when you only need fast local test feedback

Test DB / Redis for baseline runs:
- The baseline command reads `DATABASE_URL` and `REDIS_URL` from the environment, and otherwise defaults to test-safe local values.
- Recommended local test values:
  - `DATABASE_URL=postgresql+asyncpg://prompttune:prompttune@localhost:5432/prompttune_test`
  - `REDIS_URL=redis://localhost:6379/0`
- You only need to override those values when your test services live elsewhere; otherwise `python scripts/agent/quick_check.py` uses them automatically.
- GitHub Actions uses the same `python scripts/agent/quick_check.py` entrypoint with those CI env vars pointed at the workflow service containers.

Then set env vars for the extension:

```
VITE_BACKEND_MODE=fastapi
VITE_API_BASE_URL=http://localhost:8000
```

Backend env vars for local FastAPI runs (create `backend/.env`, do not commit; copy the needed keys from `infra/.env.example` and switch `DATABASE_URL` / `REDIS_URL` to localhost):

```env
LLM_BACKEND=OPENROUTER        # or OPENAI
OPENROUTER_API_KEY=REPLACE_ME # required when LLM_BACKEND=OPENROUTER
# OPENAI_API_KEY=REPLACE_ME   # required when LLM_BACKEND=OPENAI
DATABASE_URL=postgresql+asyncpg://prompttune:prompttune@localhost:5432/prompttune
REDIS_URL=redis://localhost:6379/0
```

#### n8n override

Requires an n8n instance with the "Prompt Improver API" workflow active.

```bash
cd extension
npm run dev
```

Env vars:

```
VITE_BACKEND_MODE=n8n
VITE_N8N_WEBHOOK_URL=http://localhost:5678/webhook/improve-prompt
```

Notes:
- The backend uses **server-owned provider keys**; the extension does **not** send provider keys in request headers.
- The extension automatically includes `client=\"extension\"` and `client_version=<manifest version>` on `/v1/improve` calls.
- The built extension manifest includes `https://api.anytoolai.store/*` in `host_permissions`.

##### Smoke test (local)
- Start Postgres + Redis (or use Docker via `infra/`).
- Start backend and open `http://localhost:8000/docs`.
- Call `GET /healthz` and `GET /readyz`.
- Call `POST /v1/improve` with JSON body including `text`, `installation_id`, and `client` (Swagger will validate).
- Run the extension in dev mode and click **Improve** in the popup; it should return improved text.

### Full Stack (Docker)

```bash
cd infra
make dev-up-d      # Starts api, postgres, redis for local development
make dev-down      # Stops the local dev stack
```

For VPS deployment behind Caddy at `api.anytoolai.store`, use the runbook in `docs/deployment.md`.
