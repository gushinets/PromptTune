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

### Backend

The extension supports two backends, controlled by the `VITE_BACKEND_MODE` env var:

| Mode | Description | Default |
|------|-------------|---------|
| `n8n` | Calls an n8n webhook (current default) | `http://localhost:5678/webhook/improve-prompt` |
| `fastapi` | Calls the FastAPI backend | `http://localhost:8000/v1/improve` |

#### n8n (default)

Requires an n8n instance with the "Prompt Improver API" workflow active.

```bash
cd extension
npm run dev
```

Env vars (optional, shown with defaults):

```
VITE_BACKEND_MODE=n8n
VITE_N8N_WEBHOOK_URL=http://localhost:5678/webhook/improve-prompt
```

#### FastAPI

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

Then set env vars for the extension:

```
VITE_BACKEND_MODE=fastapi
VITE_API_BASE_URL=http://localhost:8000
```

Backend env vars (in `backend/.env`, **do not commit**):

```env
LLM_BACKEND=OPENROUTER        # or OPENAI
OPENROUTER_API_KEY=REPLACE_ME # required when LLM_BACKEND=OPENROUTER
# OPENAI_API_KEY=REPLACE_ME   # required when LLM_BACKEND=OPENAI
DATABASE_URL=postgresql+asyncpg://prompttune:prompttune@localhost:5432/prompttune
REDIS_URL=redis://localhost:6379/0
```


```env
# Directory for log files (default: backend/logs)
LOGS_DIR=logs
# Log file name (default: access.log)
LOG_FILE=access.log
# Maximum log file size in bytes (default: 10485760 = 10 MB)
LOG_MAX_SIZE=10485760
# Number of backup log files to keep (default: 5)
LOG_BACKUP_COUNT=5
```

Notes:
- The backend uses **server-owned provider keys**; the extension does **not** send provider keys in request headers.
- The extension automatically includes `client=\"extension\"` and `client_version=<manifest version>` on `/v1/improve` calls.

##### Smoke test (local)
- Start Postgres + Redis (or use Docker via `infra/`).
- Start backend and open `http://localhost:8000/docs`.
- Call `GET /healthz` and `GET /readyz`.
- Call `POST /v1/improve` with JSON body including `text`, `installation_id`, and `client` (Swagger will validate).
- Run the extension in dev mode and click **Improve** in the popup; it should return improved text.

### Full Stack (Docker)

```bash
cd infra
make dev           # Starts api, postgres, redis, caddy
make down          # Stops all services
```
