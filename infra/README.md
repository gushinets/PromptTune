## Infra (Docker) quickstart

This folder contains Docker Compose configurations for running the full PromptTune backend stack:
- FastAPI (`api`)
- PostgreSQL (`postgres`)
- Redis (`redis`)
- (prod only) Caddy reverse proxy (`caddy`)

### Setup

Create an `infra/.env` file from one of the examples:
- `infra/.env.dev.example` for local development
- `infra/.env.prod.example` for production-like settings

The compose files reference `env_file: .env`, so the `.env` file **must** exist in this folder.
Use plain `KEY=value` lines only. Do not append inline comments on the same line as a value, because Docker may treat them as part of the value.

### Provider keys (server-owned)

The backend uses **server-owned provider keys**. Set one of:
- `LLM_BACKEND=OPENROUTER` + `OPENROUTER_API_KEY=...`
- `LLM_BACKEND=OPENAI` + `OPENAI_API_KEY=...`

Do not commit real keys. Use environment injection/secrets in CI/CD and production.
After editing `infra/.env`, recreate the stack so Docker reloads the environment:

```bash
docker compose -f docker-compose.base.yml -f docker-compose.dev.yml down
docker compose -f docker-compose.base.yml -f docker-compose.dev.yml up --build -d
```

### Commands

From `infra/`:

- Start dev stack (foreground):

```bash
make dev
```

- Start dev stack (background):

```bash
make dev-d
```

- Apply migrations:

```bash
make migrate
```

- Stop everything:

```bash
make down
```
