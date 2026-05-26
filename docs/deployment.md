# VPS Backend Deployment

This document is the canonical runbook for deploying the backend stack on a single Ubuntu VPS with Docker Compose and Caddy.

Target host:

- `https://api.anytoolai.store`

Services in the production stack:

- `api` - FastAPI backend
- `postgres` - PostgreSQL
- `redis` - Redis
- `caddy` - reverse proxy with automatic HTTPS

## MVP deployment posture

- CORS is temporarily permissive: `ALLOWED_ORIGINS=*`
- Provider API keys stay on the server only
- No off-box backups are included in this MVP
- Only ports `80` and `443` should be publicly reachable

## Prerequisites

Before the first deploy, verify all of the following:

- `api.anytoolai.store` points to the VPS public IP
- inbound `80/tcp` and `443/tcp` are open
- Docker Engine and Docker Compose are already installed on the VPS
- `make` is installed, or you will use the raw `docker compose` commands shown below instead of the `make` shortcuts
- no other reverse proxy or web server is bound to `80` or `443`
- the repo is checked out on the VPS
- you have one provider key ready:
  - `OPENROUTER_API_KEY`, or
  - `OPENAI_API_KEY`

## 1. Prepare the production env file

On the VPS:

```bash
cd /path/to/PromptTune/infra
cp .env.example .env
```

Edit `infra/.env` and set:

- `POSTGRES_PASSWORD`
- `DATABASE_URL` so the password in the URL matches `POSTGRES_PASSWORD`
- `LLM_BACKEND`
- `OPENROUTER_API_KEY` or `OPENAI_API_KEY` to match `LLM_BACKEND`
- `INSTALLATION_ID_SALT`
- `IP_SALT`

Production example:

- `POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD`
- `DATABASE_URL=postgresql+asyncpg://prompttune:CHANGE_ME_STRONG_PASSWORD@postgres:5432/prompttune`
- `INSTALLATION_ID_SALT=CHANGE_ME_INSTALLATION_SALT`
- `IP_SALT=CHANGE_ME_IP_SALT`

Keep these values as-is for the MVP deploy:

- `REDIS_URL=redis://redis:6379/0`
- `ALLOWED_ORIGINS=*`

The password inside `DATABASE_URL` must match `POSTGRES_PASSWORD` or the API and migration containers will fail to connect to Postgres.

Why `ALLOWED_ORIGINS=*` for now:

- the browser extension will call the API directly
- the final extension store IDs/origins are not known yet
- this is temporary and should be tightened after the published extension IDs/origin rules are known

## 2. Validate the production compose config

```bash
cd /path/to/PromptTune/infra
make prod-config
```

If `make` is not installed:

```bash
cd /path/to/PromptTune/infra
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml config --quiet
```

This validates the Compose configuration without printing resolved env values. On success it exits with no output.

## 3. Recommended guarded deploy

For routine production deploys, use the guarded script:

```bash
cd /path/to/PromptTune/infra
make prod-preflight
make prod-deploy
```

Or run the script directly:

```bash
cd /path/to/PromptTune/infra
./scripts/deploy-prod.sh --preflight-only
./scripts/deploy-prod.sh
```

What the script adds on top of the raw Compose flow:

- checks that `infra/.env` exists and required production keys are set
- validates the production Compose config
- checks free space on `/` and Docker's root directory before rebuilding images
- warns if the repo checkout is dirty so you know exactly what is being deployed
- builds the `api` image once, reuses it for migrations, then restarts `api` and `caddy`
- verifies `healthz`, `readyz`, and `/v1/limits` after the rollout
- prunes dangling Docker images and build cache after a successful deploy to recover disk space

Useful options:

- `--preflight-only` validates without changing containers
- `--skip-smoke` skips the post-deploy HTTP checks
- `--base-url https://...` overrides the default smoke-test host
- `--min-free-mb 2048` raises or lowers the free-space threshold

Environment overrides:

- `BASE_URL`
- `MIN_FREE_MB`
- `LIMITS_INSTALLATION_ID`

## 4. First deploy

Run the production deployment in this order:

```bash
cd /path/to/PromptTune/infra
make prod-db-up
make prod-migrate
make prod-up
```

If `make` is not installed:

```bash
cd /path/to/PromptTune/infra
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml up -d postgres redis
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml run --rm --build api alembic upgrade head
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml up --build -d api caddy
```

What each step does:

- `prod-db-up` starts `postgres` and `redis`
- `prod-migrate` runs `alembic upgrade head` in a one-shot `api` container using the same `DATABASE_URL` as the app
- `prod-up` builds and starts `api` and `caddy`

This manual sequence remains available as the low-level fallback behind the guarded script.

## 5. Verify the deploy

Check container state:

```bash
cd /path/to/PromptTune/infra
make prod-ps
make prod-logs
```

If `make` is not installed:

```bash
cd /path/to/PromptTune/infra
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml ps
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml logs -f
```

Health checks:

```bash
curl -i https://api.anytoolai.store/healthz
curl -i https://api.anytoolai.store/readyz
```

Expected result:

- both endpoints return `200 OK`
- `readyz` only returns `200` after Postgres and Redis are reachable

## 6. Verify CORS for MVP browser traffic

The backend currently allows all origins so browser requests can work before the final extension IDs are known.

Preflight check:

```bash
curl -i -X OPTIONS https://api.anytoolai.store/v1/improve \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

Expected result:

- the response contains `access-control-allow-origin`
- the response allows `POST`

Application request smoke test:

```bash
curl -i https://api.anytoolai.store/v1/limits?installation_id=test-installation
```

## 7. Redeploy after changes

When new backend or infra changes are pulled onto the VPS:

```bash
cd /path/to/PromptTune
git pull
cd infra
make prod-deploy
```

If `make` is not installed:

```bash
cd /path/to/PromptTune
git pull
cd infra
./scripts/deploy-prod.sh
```

Notes:

- `prod-deploy` runs the preflight checks first and then executes the rollout
- the script deploys the current local checkout; run `git pull` first if you want the latest remote changes
- migrations remain safe to run on every deploy; if there are no new revisions they become a no-op

## 8. Rollback

Code/config rollback procedure:

```bash
cd /path/to/PromptTune
git log --oneline -n 5
git switch --detach <previous-good-commit>
cd infra
make prod-up
```

If the failed deploy included a schema migration, a code rollback may not be enough on its own. This MVP does not include automated off-box backups, so treat irreversible schema changes carefully.

This leaves the repo in detached HEAD state. Before the next normal deploy, switch back to your deployment branch (for example `git switch main`) and then run `git pull`.

After rollback, verify again:

```bash
cd /path/to/PromptTune/infra
make prod-ps
curl -i https://api.anytoolai.store/healthz
curl -i https://api.anytoolai.store/readyz
```

If `make` is not installed:

```bash
cd /path/to/PromptTune/infra
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml ps
curl -i https://api.anytoolai.store/healthz
curl -i https://api.anytoolai.store/readyz
```

## 9. Shutdown

To stop the production stack:

```bash
cd /path/to/PromptTune/infra
make prod-down
```

If `make` is not installed:

```bash
cd /path/to/PromptTune/infra
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml down
```

## Caddy notes

The production Caddy configuration lives in `infra/caddy/Caddyfile`.

Important behavior:

- it serves `api.anytoolai.store`
- it obtains HTTPS certificates automatically after DNS is pointed at the VPS
- it proxies traffic to `api:8000`
- it limits request bodies to `1MB`
- it writes access logs to stdout for `docker compose logs`

If you want ACME notification emails, uncomment and set the `email` line in the global Caddy options block.

## Security notes

- keep `infra/.env` out of git
- never expose provider keys to the extension or frontend
- do not publish `5432` or `6379` to the public internet
- keep SSH locked down separately at the VPS level

## Follow-up after extension publication

This backend deploy intentionally stops at temporary permissive CORS. The extension already defaults to `https://api.anytoolai.store` and derives the matching API host permission from `VITE_API_BASE_URL`.

After the browser extensions are published, the remaining follow-up is:

- replace `ALLOWED_ORIGINS=*` with explicit extension/site origin handling
