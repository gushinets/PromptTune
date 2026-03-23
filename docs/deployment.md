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
- no other reverse proxy or web server is bound to `80` or `443`
- the repo is checked out on the VPS
- you have one provider key ready:
  - `OPENROUTER_API_KEY`, or
  - `OPENAI_API_KEY`

## 1. Prepare the production env file

On the VPS:

```bash
cd /path/to/PromptTune/infra
cp .env.prod.example .env
```

Edit `infra/.env` and set:

- `POSTGRES_PASSWORD`
- `LLM_BACKEND`
- `OPENROUTER_API_KEY` or `OPENAI_API_KEY`

Keep these values as-is for the MVP deploy:

- `DATABASE_URL=postgresql+asyncpg://prompttune:<POSTGRES_PASSWORD>@postgres:5432/prompttune`
- `REDIS_URL=redis://redis:6379/0`
- `ALLOWED_ORIGINS=*`

Why `ALLOWED_ORIGINS=*` for now:

- the browser extension will call the API directly
- the final extension store IDs/origins are not known yet
- this is temporary and should be tightened after the published extension IDs/origin rules are known

## 2. Validate the production compose config

```bash
cd /path/to/PromptTune/infra
make prod-config
```

This should render a valid Docker Compose configuration with no missing env values or syntax errors.

## 3. First deploy

Run the production deployment in this order:

```bash
cd /path/to/PromptTune/infra
make prod-db-up
make prod-migrate
make prod-up
```

What each step does:

- `prod-db-up` starts `postgres` and `redis`
- `prod-migrate` runs `alembic upgrade head` in a one-shot `api` container using the same `DATABASE_URL` as the app
- `prod-up` builds and starts `api` and `caddy`

## 4. Verify the deploy

Check container state:

```bash
cd /path/to/PromptTune/infra
make prod-ps
make prod-logs
```

Health checks:

```bash
curl -i https://api.anytoolai.store/healthz
curl -i https://api.anytoolai.store/readyz
```

Expected result:

- both endpoints return `200 OK`
- `readyz` only returns `200` after Postgres and Redis are reachable

## 5. Verify CORS for MVP browser traffic

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

## 6. Redeploy after changes

When new backend or infra changes are pulled onto the VPS:

```bash
cd /path/to/PromptTune
git pull
cd infra
make prod-config
make prod-migrate
make prod-up
```

Notes:

- `prod-migrate` is safe to run on every deploy; if there are no new migrations it becomes a no-op
- `prod-up` rebuilds the `api` image from the current repo checkout and restarts the production services

## 7. Rollback

Code/config rollback procedure:

```bash
cd /path/to/PromptTune
git log --oneline -n 5
git checkout <previous-good-commit>
cd infra
make prod-up
```

If the failed deploy included a schema migration, a code rollback may not be enough on its own. This MVP does not include automated off-box backups, so treat irreversible schema changes carefully.

After rollback, verify again:

```bash
cd /path/to/PromptTune/infra
make prod-ps
curl -i https://api.anytoolai.store/healthz
curl -i https://api.anytoolai.store/readyz
```

## 8. Shutdown

To stop the production stack:

```bash
cd /path/to/PromptTune/infra
make prod-down
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

This backend deploy intentionally stops at temporary permissive CORS.

After the browser extensions are published, tighten the client side and server side:

- add `https://api.anytoolai.store/*` to extension `host_permissions`
- set the extension production API base URL to `https://api.anytoolai.store`
- replace `ALLOWED_ORIGINS=*` with explicit extension/site origin handling
