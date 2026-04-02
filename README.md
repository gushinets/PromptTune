# PromptTune

Browser extension for AI prompt improvement. Supports Chrome, Edge, and Firefox.

## Project Structure

- **extension/** — WXT + TypeScript + React browser extension
- **backend/** — FastAPI + LiteLLM + PostgreSQL + Redis
- **infra/** — Docker Compose configs, Caddy reverse proxy
- **docs/** — Project documentation

## Quick Start

### Extension

```bash
cd extension
npm install
npm run dev        # WXT dev mode (Chrome)
npm run build      # Production build
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
pip install -e "backend[dev]" # with dev dependencies (pytest, ruff)
# OR runtime only
pip install -e backend
cd backend
uvicorn app.main:app --reload
```

Backend dependency policy and validation:
- Use `backend/pyproject.toml` as the single source of truth for Python dependencies.
- Do not maintain `backend/requirements.in` or `backend/requirements.txt`.
- From `backend/`, run:
  - `pip install -e .` (runtime)
  - `pip install -e ".[dev]"` (dev/test/lint)
  - `pytest -q`
  - `ruff check .`
  - `ruff format --check .`
- One-time sanity check:
  - `pip install -e "backend[dev]"`
  - `python -c "from importlib.metadata import version; print(version('litellm'))"` (expected: `1.82.2`)

Then set env vars for the extension:

```
VITE_BACKEND_MODE=fastapi
VITE_API_BASE_URL=http://localhost:8000
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


```env
LLM_BACKEND=OPENROUTER        # or OPENAI
OPENROUTER_API_KEY=REPLACE_ME # required when LLM_BACKEND=OPENROUTER
# OPENAI_API_KEY=REPLACE_ME   # required when LLM_BACKEND=OPENAI
DATABASE_URL=postgresql+asyncpg://prompttune:prompttune@localhost:5432/prompttune
REDIS_URL=redis://localhost:6379/0
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
