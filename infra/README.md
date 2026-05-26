## Infra (Docker) quickstart

This folder contains Docker Compose configurations for the PromptTune backend stack:
- FastAPI (`api`)
- PostgreSQL (`postgres`)
- Redis (`redis`)
- production-only Caddy reverse proxy (`caddy`)

## Setup

Create `infra/.env` from the single template:

```bash
cp .env.example .env
```

For production, edit at least:

- `POSTGRES_PASSWORD`
- `DATABASE_URL` so the password matches `POSTGRES_PASSWORD`
- `LLM_BACKEND`
- `OPENROUTER_API_KEY` or `OPENAI_API_KEY`
- `INSTALLATION_ID_SALT`
- `IP_SALT`

Keep `REDIS_URL=redis://redis:6379/0` and `ALLOWED_ORIGINS=*` for the MVP deploy.

The compose files use `env_file: .env`, so `infra/.env` must exist before starting either stack.
Use plain `KEY=value` lines only. Do not append inline comments to values.

## Provider keys

The backend uses server-owned provider keys. Set one of:
- `LLM_BACKEND=OPENROUTER` and `OPENROUTER_API_KEY=...`
- `LLM_BACKEND=OPENAI` and `OPENAI_API_KEY=...`

Do not commit real keys.

## Development commands

Run these from `infra/`:

```bash
make dev-up       # foreground api + postgres + redis
make dev-up-d     # background api + postgres + redis
make dev-migrate  # alembic upgrade head in a one-shot api container
make dev-logs
make dev-ps
make dev-config   # validate dev compose config without printing resolved env values
make dev-down
```

Legacy aliases remain available:

```bash
make dev
make dev-d
make logs
make migrate
```

## Production commands

Use the production stack only for VPS deployment. The canonical runbook lives in `docs/deployment.md`.

These `make` targets are convenience wrappers. If `make` is not installed on the VPS, run the equivalent `docker compose -f docker-compose.base.yml -f docker-compose.prod.yml ...` commands directly.

Recommended guarded flow:

```bash
make prod-preflight  # env/config/free-space checks only
make prod-deploy     # preflight + db/redis + build + migrate + restart + smoke checks
```

The deploy script lives at `infra/scripts/deploy-prod.sh`. It deploys the current checkout exactly as-is, warns if the git worktree is dirty, builds the `api` image once, then reuses that image for the migration step and final restart. After a successful deploy it prunes dangling Docker images and build cache to recover space on small VPS disks.

```bash
make prod-db-up    # start postgres + redis only
make prod-migrate  # apply alembic migrations using the prod env
make prod-up       # build/start api + caddy
make prod-logs
make prod-ps
make prod-config   # validate prod compose config without printing resolved env values
make prod-preflight
make prod-deploy
make prod-down
```

Both config targets use `docker compose ... config --quiet`, so success produces no output.

`infra/.env.example` documents `ALLOWED_ORIGINS=*` for the MVP deploy until browser-extension IDs/origins are known.
