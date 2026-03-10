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
| `fastapi` | Calls the FastAPI backend (not yet implemented) | `http://localhost:8000/v1/improve` |

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

#### FastAPI (future)

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

### Full Stack (Docker)

```bash
cd infra
make dev           # Starts api, postgres, redis, caddy
make down          # Stops all services
```
