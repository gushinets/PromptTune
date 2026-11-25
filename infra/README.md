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

Keep `REDIS_URL=redis://redis:6379/0`. Production `ALLOWED_ORIGINS` must contain
the exact PromptOptimizer origin, `chrome-extension://fbageijibmjblopdbgpdcpkojhnjjbpe`.
Add future browser extension or site origins as a comma-separated list; never use `*`.

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

Use the production stack only for VPS deployment. Follow the
[canonical runbook](../docs/deployment.md#3-standard-production-deploy-load-the-approved-image)
for first deployment, routine updates and rollback. Select the approved image
and matching dependency report from the same successful Trivy run, retain them,
check out their approved source commit, verify the archive checksum and load it.
Then, from `infra/`, use its exact image ID:

```bash
# release_dir points to the retained, verified release directory from the runbook.
image="$(cat "$release_dir/image/backend-image-id.txt")"
./scripts/deploy-prod.sh --image "$image" --preflight-only
./scripts/deploy-prod.sh --image "$image"
```

The image path removes the API build recipe, disables building/pulling, creates
and verifies the API container before starting it, and uses the approved image
for migrations and startup. A failed identity check stops the API. Existing
support containers are started with `--no-recreate`; do not pull mutable support
tags during a backend release. Provision or update the support stack separately,
recording its approved image digests and rollback plan. Keep the original backend
artifacts for rollback; an image
ID that cannot be inspected after loading must not be replaced by a tag or a
rebuild. No `make` installation is required for this flow.

Read-only/supporting stack helpers remain available:

```bash
make prod-logs
make prod-ps
make prod-config   # validate prod compose config without printing resolved env values
make prod-down
```

Both config targets use `docker compose ... config --quiet`, so success produces no output.

The legacy `make prod-up`, `make prod-migrate`, `make prod-deploy` and bare
`./scripts/deploy-prod.sh` helpers build from source. They are for isolated source
validation, not standard production release or rollback. A rebuilt candidate
requires its own complete Trivy scan and release decision, followed by the saved
image procedure above. `make prod-preflight` without an image checks source-mode
configuration only; use `--image ... --preflight-only` to validate a release.

`infra/.env.example` contains the Chrome Web Store extension origin. The deploy preflight
rejects wildcard CORS and verifies that `CORS_SMOKE_ORIGIN` is present in `ALLOWED_ORIGINS`.
The backend also refuses to start if any configured origin is `*`, including manual Compose flows.
The post-deploy smoke test checks allowed and rejected CORS preflights on all extension API endpoints.

## Optional outbound provider proxy

Production provider HTTP(S) traffic can be routed from `api` through the internal `egress-lb` HAProxy service:

```bash
HTTPS_PROXY=http://egress-lb:3128
HTTP_PROXY=http://egress-lb:3128
NO_PROXY=localhost,127.0.0.1,postgres,redis
```

`egress-lb` health-checks configured locked-down Squid forward proxies by opening an HTTP `CONNECT` tunnel to `api.openai.com:443`. Only the primary proxy receives traffic while healthy; additional proxies are configured as HAProxy backups. The companion `egress-alert` service reads HAProxy metrics and sends ntfy notifications when fewer than the expected number of forward proxies are available. See `docs/deployment.md` for the full setup, verification, and rollback flow.
