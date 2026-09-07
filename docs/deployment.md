# VPS Backend Deployment

This document is the canonical runbook for deploying the backend stack on a single Ubuntu VPS with Docker Compose and Caddy.

Target host:

- `https://api.anytoolai.store`

Services in the production stack:

- `api` - FastAPI backend
- `postgres` - PostgreSQL
- `redis` - Redis
- `caddy` - reverse proxy with automatic HTTPS

## Production deployment posture

- CORS allows only the PromptOptimizer extension origin by default
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
- `ALLOWED_ORIGINS` if the deployed extension origin differs from the current Chrome Web Store ID

Production example:

- `POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD`
- `DATABASE_URL=postgresql+asyncpg://prompttune:CHANGE_ME_STRONG_PASSWORD@postgres:5432/prompttune`
- `INSTALLATION_ID_SALT=CHANGE_ME_INSTALLATION_SALT`
- `IP_SALT=CHANGE_ME_IP_SALT`

Keep these values as-is for the MVP deploy:

- `REDIS_URL=redis://redis:6379/0`
- `ALLOWED_ORIGINS=chrome-extension://fbageijibmjblopdbgpdcpkojhnjjbpe`

The password inside `DATABASE_URL` must match `POSTGRES_PASSWORD` or the API and migration containers will fail to connect to Postgres.

Why `ALLOWED_ORIGINS` is explicit:

- the browser extension will call the API directly
- the Chrome Web Store extension ID is `fbageijibmjblopdbgpdcpkojhnjjbpe`
- unrelated web pages must not receive browser permission to call the API

To add another browser build or a site that genuinely calls the API, append its exact origin
with a comma and no path, for example:

```dotenv
ALLOWED_ORIGINS=chrome-extension://fbageijibmjblopdbgpdcpkojhnjjbpe,moz-extension://EXACT-FIREFOX-UUID,https://app.example.com
```

Do not add marketing or documentation origins unless their browser code directly calls this API.
The backend refuses to start if any configured origin is `*`, including manual Compose flows.
The guarded deploy additionally requires `CORS_SMOKE_ORIGIN` to appear in the list.

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
- `CORS_SMOKE_ORIGIN` selects the configured extension origin used by CORS smoke checks

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

## 5. Optional outbound HTTPS proxy

If the provider blocks direct egress from the backend VPS, route outbound provider traffic through the internal HAProxy egress load balancer. On the current production host (`135.106.164.145`, repo path `/opt/PromptTune/infra`), public Caddy is owned by the separate `payments-portal-prod` stack and is attached to `infra_prompttune`; do not start the PromptTune `caddy` service on that host.

The production egress path is:

```text
api -> egress-lb:3128 -> Squid forward proxies -> api.openai.com:443
```

Set these variables in `infra/.env`:

```bash
HTTPS_PROXY=http://egress-lb:3128
HTTP_PROXY=http://egress-lb:3128
NO_PROXY=localhost,127.0.0.1,postgres,redis

EGRESS_ALERT_INTERVAL_SECONDS=60
EGRESS_ALERT_EXPECTED_ACTIVE=1
EGRESS_ALERT_EXPECTED_AVAILABLE=2
NTFY_BASE_URL=https://ntfy.sh
NTFY_TOPIC=prompttune-egress-CHANGE_ME_LONG_RANDOM_SECRET

# Current 135.106.164.145 layout uses payments-portal-prod Caddy.
PROMPTTUNE_START_CADDY=false
```

Configured Squid servers must only allow the backend VPS IP to connect to port `3128`. Do not enable TLS interception / SSL bump, do not log request bodies, and keep provider API keys only on the backend VPS. Additional proxies should be added to HAProxy as `backup` servers only after an authenticated OpenAI smoke check passes from that proxy IP.

Start only the backend-related services on the current production host:

```bash
cd /opt/PromptTune/infra
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml up -d postgres redis egress-lb egress-alert api
```

Verify HAProxy sees the active Squid backend:

```bash
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml exec egress-lb \
  wget -qO- http://localhost:8404/metrics | grep 'haproxy_backend_active_servers{proxy="squid_proxies"}'
```

Expected active value: `1`. HAProxy should also report the backup Squid as `UP`, but it should not receive traffic while the primary backend is healthy.

Verify provider egress from the API container without printing API keys:

```bash
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml exec api \
  python -c "import httpx; r=httpx.get('https://api.openai.com/v1/models', timeout=30); print(r.status_code, len(r.content))"
```

Without an API key in this smoke request, `401` or `403` from OpenAI is acceptable; the important part is that the request reaches OpenAI through `egress-lb`.

Verify ntfy delivery with the same topic:

```bash
curl -d "PromptTune egress alert test" "https://ntfy.sh/${NTFY_TOPIC}"
```

Rollback to the direct single-proxy path:

```bash
cd /opt/PromptTune/infra
# set HTTPS_PROXY and HTTP_PROXY back to a known working Squid, or remove them for direct egress
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml up -d api
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml stop egress-alert egress-lb
```

## 6. Verify the deploy

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

## 7. Verify extension CORS

The guarded deploy checks CORS automatically for `/v1/improve`, `/v1/limits`, `/v1/prompts`,
and `/v1/events`. Each route must allow the PromptOptimizer extension origin and reject an
unrelated web origin.

Manual allowed-origin preflight check:

```bash
curl -i -X OPTIONS https://api.anytoolai.store/v1/improve \
  -H "Origin: chrome-extension://fbageijibmjblopdbgpdcpkojhnjjbpe" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

Expected result:

- the response is `200`
- `access-control-allow-origin` exactly matches the extension origin
- the response allows `POST`

Manual rejected-origin preflight check:

```bash
curl -i -X OPTIONS https://api.anytoolai.store/v1/improve \
  -H "Origin: https://unrelated.example" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

Expected result: `400` with no `access-control-allow-origin` header.

Application request smoke test:

```bash
curl -i https://api.anytoolai.store/v1/limits?installation_id=test-installation
```

## 8. Redeploy after changes

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

## 9. Rollback

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

## 10. Shutdown

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

## Adding future extension origins

The extension defaults to `https://api.anytoolai.store` and derives the matching API host
permission from `VITE_API_BASE_URL`. When another browser extension origin is introduced:

1. Append the exact origin to the comma-separated `ALLOWED_ORIGINS` value.
2. Set `CORS_SMOKE_ORIGIN` to the new origin for one guarded deploy and confirm all checks pass.
3. Restore `CORS_SMOKE_ORIGIN` to the primary Chrome origin unless the deployment automation is
   intentionally being changed to monitor the new origin permanently.
