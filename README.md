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

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

### Full Stack (Docker)

```bash
cd infra
make dev           # Starts api, postgres, redis, caddy
make down          # Stops all services
```
