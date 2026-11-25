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
- First deploys, routine updates and rollbacks use an approved saved backend image
  by its exact image ID; production does not rebuild the API from the checkout

## Prerequisites

Before the first deploy, verify all of the following:

- `api.anytoolai.store` points to the VPS public IP
- inbound `80/tcp` and `443/tcp` are open
- Docker Engine and Docker Compose are already installed on the VPS
- supporting services (PostgreSQL, Redis, egress and optionally Caddy) have been
  provisioned separately with their own approved image digests and configuration
- an approved release image and matching Trivy dependency report are available
  from the same successful workflow run (see section 3)
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

## 3. Standard production deploy: load the approved image

Use this procedure for every production release, including the first deploy.
Before the first audited update of an already running, source-built production
stack, prepare and rehearse the bootstrap rollback in section 9. An old release
without a saved CI artifact or a deployer supporting `--image` needs that path.
Select the `backend-release-<sha>-<attempt>` artifact from a successful Trivy
workflow triggered by **`push` to `main`**, together with its matching
`backend-dependencies-<sha>-<attempt>` report from the same run. Verify the run's
event is `push`, its branch is `main`, and the artifact SHA equals the run's full
head commit SHA. PR runs are review evidence only: their `github.sha` can name a
temporary `refs/pull/.../merge` commit that a release host cannot fetch normally.
Do not use PR artifacts for production or rollback.

Review the complete OS/Python report, record a release decision
for every remaining High/Critical, and record the approved commit SHA and image
ID. Check that `backend-health.json` in the dependency evidence records that same
image ID and HTTP 200 from both `/healthz` and `/readyz`; the workflow runs migrations
and starts the exact scanned image against disposable PostgreSQL/Redis. A
successful scan job alone is not a release approval.

Keep both artifacts and the approval outside the repository, for example under
`/opt/prompttune-releases/APPROVED_SHA-ATTEMPT/`. Extract the release workflow
artifact ZIP into `image/` and the dependency artifact ZIP into `evidence/`.
Keep `backend-image.tar` intact: `docker load` consumes that file. The workflow artifact
expires after seven days; retain an approved copy and the previous approved
release for rollback before then. The workflow saves the actual linux/amd64
image, not a rebuild recipe.

Check out the approved source commit so deployment scripts and configuration
correspond to the artifact. Replace `APPROVED_SHA` and `APPROVED_SHA-ATTEMPT`
below with the recorded values; do not use an unrelated latest checkout.
Stop if artifact comparison, checksum verification or image inspection fails.

```bash
set -e
cd /path/to/PromptTune
git fetch origin main
git merge-base --is-ancestor APPROVED_SHA origin/main
git checkout --detach APPROVED_SHA

release_dir=/opt/prompttune-releases/APPROVED_SHA-ATTEMPT
cmp "$release_dir/image/backend-image-id.txt" "$release_dir/evidence/backend-image-id.txt"
(cd "$release_dir/image" && sha256sum -c backend-image.tar.sha256)
docker load --input "$release_dir/image/backend-image.tar"
image="$(cat "$release_dir/image/backend-image-id.txt")"
docker image inspect --format '{{.Id}} {{.Os}}/{{.Architecture}}' "$image"
# Must equal the approved backend-image-id.txt and linux/amd64.

cd /path/to/PromptTune/infra
# Supporting services were provisioned separately; do not pull/update their tags here.
./scripts/deploy-prod.sh --image "$image" --preflight-only
./scripts/deploy-prod.sh --image "$image"
```

Section 5 describes the existing host's external Caddy configuration. Set
`PROMPTTUNE_START_CADDY=false` there before deploying; on a dedicated host using
PromptTune's own Caddy, include Caddy in the separate support-stack provisioning.

Backend release and rollback leave existing supporting containers in place
(`--no-recreate`), even if a local mutable tag now points to a newer image.
Do not run `docker compose pull` as a backend release preparation step. A database,
cache, egress or Caddy update is a separate maintenance change: approve and record
its image digests and configuration, plan its data/config rollback, then apply it
explicitly. Retain that support-stack record alongside the backend approval.
For a first deployment, complete that provisioning before the backend procedure.
Release preflight rejects missing support containers; it does not bootstrap or
update them, and missing local support images are not fetched.

The guarded script:

- checks that `infra/.env` exists and required production keys are set
- validates the production Compose config
- checks free space on `/` and Docker's root directory
- warns if the repo checkout is dirty; use the approved clean source checkout
- requires the selected image to be loaded locally and to target linux/amd64
- starts supporting services without pulling or recreating existing containers
- runs migrations from the selected image while the previous API keeps serving;
  a migration failure exits before replacing that container
- creates the replacement API without starting it, excludes one-off diagnostic
  containers and requires a single regular API container with the approved `.Image`
- starts that exact verified container
- checks the started container again and stops it if identity verification fails
- verifies `healthz`, `readyz`, and `/v1/limits` after the rollout
- prunes dangling Docker images and build cache after a successful deploy to recover disk space

The release override uses Compose's `!reset` tag to remove the API build recipe
(validated with Compose v5.7.1). Configuration preflight fails before rollout on
incompatible Compose versions. The base is Python 3.12.16 / Debian trixie, pinned
to its multiarch index in `backend/Dockerfile`, plus the libzstd1 security update.

The exact image ID's representation depends on Docker's image store: containerd
can use an OCI index digest while the classic store uses a config digest. Build
and release hosts must preserve the same representation. If the original ID is
unavailable after loading, stop and produce a fresh build/scan on a compatible
host; do not substitute a different ID or rebuild during deployment. There is no
registry push in this workflow. The archive checksum verifies transport bytes
and is separate from the approved image ID.

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

After preparing `infra/.env`, configure the egress/Caddy settings from section 5
and follow the artifact selection, checksum, loading and preflight steps in
section 3. Start the first release with the image ID read from that artifact:

```bash
cd /path/to/PromptTune/infra
./scripts/deploy-prod.sh --image "$image"
```

The script starts PostgreSQL/Redis, waits for them, runs `alembic upgrade head`
using the approved image and production `DATABASE_URL`, then starts the same API
image and the selected supporting services. Do not run a separate source-building
migration or startup command before it. No `make` installation is required.
The previous API stays running until migrations succeed. Preparing the replacement
then introduces a brief restart window. A failed image check leaves the new API
stopped rather than serving an unapproved image. Preflight rejects multiple
regular API instances and ignores one-off containers left by `compose run`;
one-off support containers do not count as a provisioned support service.

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

Load the approved artifact and set `image` as in section 3, then deploy only the
backend-related services on the current production host:

```bash
cd /opt/PromptTune/infra
./scripts/deploy-prod.sh --image "$image" --preflight-only
./scripts/deploy-prod.sh --image "$image"
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
# Keep the current approved API image; recover its ID from the retained release artifact.
image="$(cat "$release_dir/image/backend-image-id.txt")"
./scripts/deploy-prod.sh --image "$image"
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

A new checkout is not an approved image. For an ordinary update:

1. Select the successful Trivy **push-to-main** run for the desired commit and review its matching
   release/dependency artifacts and remaining High/Critical findings.
2. Retain the current approved artifact, image ID and source commit for rollback.
3. Follow section 3 to check out the newly approved commit, verify and load its
   saved image, and set `image` from that release's `backend-image-id.txt`.
4. Deploy with the guarded image path:

```bash
cd /path/to/PromptTune/infra
./scripts/deploy-prod.sh --image "$image" --preflight-only
./scripts/deploy-prod.sh --image "$image"
```

Migrations run from that same image on every deploy and become a no-op when no
new revisions exist. Do not replace these commands with a source build after
`git pull`; that would produce an image outside the approved audit.

### Building a new candidate requires a separate audit

If a source change, base update or dependency change requires rebuilding, build
and scan a new candidate through the Trivy workflow, review its actual installed
OS/Python packages, and record a new release decision. Then load its saved image
and deploy through section 3. Production candidates come from the main push run
after the source change is merged, not its temporary PR merge ref. A scan of an
earlier build does not approve it.

The legacy `make prod-up`, `make prod-migrate`, `make prod-deploy` and bare
`./scripts/deploy-prod.sh` helpers still build from the checkout. They are source
build helpers for isolated validation, not the standard first-deploy, update or
rollback procedure. Any image produced with them needs its own complete scan
and release decision before production use. Use the `dev-*` targets for local
development.

## 9. Rollback

Keep a copy of the previous approved image archive, matching dependency report,
image ID and source commit outside the repository. Before an image rollback,
check schema compatibility: the guarded script runs `alembic upgrade head` from
the selected image, and an older application/migration set may not understand a
newer schema. It does not downgrade or restore the database automatically. If
needed, complete the separately reviewed database recovery before continuing.

### First transition from a legacy source-built production release

Before changing the existing API, capture its **running image**, not a rebuild
of its old Git commit. Select the running regular API container, verify its
Compose service/project labels, and record its source revision separately.
Prepare a private server-only rollback directory outside the repository:

```bash
set -euo pipefail
umask 077
cd /path/to/PromptTune
git fetch origin main
api_container=RUNNING_REGULAR_API_CONTAINER_ID
rollback_dir=/opt/prompttune-releases/bootstrap-ROLLBACK_ID
deployer_sha=COMPATIBLE_DEPLOYER_SHA
test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$api_container")" = api
case "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.oneoff"}}' "$api_container")" in
  False|false) ;;
  *) echo 'Select the regular API container, not a diagnostic one-off' >&2; exit 1 ;;
esac
project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$api_container")"
test -n "$project"
image="$(docker inspect --format '{{.Image}}' "$api_container")"
test ! -e "$rollback_dir"
mkdir -p "$rollback_dir/image" "$rollback_dir/evidence" "$rollback_dir/deployer"
printf '%s\n' "$image" > "$rollback_dir/image/backend-image-id.txt"
printf '%s\n' "$project" > "$rollback_dir/compose-project.txt"
docker image inspect "$image" > "$rollback_dir/evidence/backend-image.json"
docker image save --output "$rollback_dir/image/backend-image.tar" "$image"
(cd "$rollback_dir/image" && sha256sum backend-image.tar > backend-image.tar.sha256)

# Freeze a reviewed deployer from a successful main-push release that supports --image.
git merge-base --is-ancestor "$deployer_sha" origin/main
git archive "$deployer_sha" infra | tar -x -C "$rollback_dir/deployer"
printf '%s\n' "$deployer_sha" > "$rollback_dir/deployer-sha.txt"
# This copy contains production secrets: keep it private on the server, never upload it.
install -m 600 infra/.env "$rollback_dir/deployer/infra/.env"
COMPOSE_PROJECT_NAME="$project" bash "$rollback_dir/deployer/infra/scripts/deploy-prod.sh" \
  --image "$image" --preflight-only
```

Replace `COMPATIBLE_DEPLOYER_SHA` with the approved **new** deployer commit, not
the legacy application commit. Keep its full `infra/` tree so relative paths,
release Compose overrides and mounted assets remain available. The explicit
Compose project name is essential: running from the saved directory must target
the existing stack, not create a different project. Existing supporting containers
remain in place because the audited path uses `--no-recreate`.

Scan the captured legacy IID's actual OS/Python packages, record an explicit
rollback disposition for its findings, and retain the report and archive checksum
with this record. Before the first update, rehearse loading that archive and
restoring it through the **saved compatible deployer** on a disposable stack with
sanitized configuration and an isolated Compose project. Check the running IID,
migrations and both health endpoints. Also review schema compatibility and prepare
database recovery if the new migrations cannot be used by the old image. Do not
proceed with the first update without a rehearsed rollback or a separately audited
compatible rollback candidate.

If the first audited rollout fails, restore database state first if required,
then use the retained bundle; do **not** check out the old source and invoke its
old `deploy-prod.sh` (for example, `b26a78f` does not support `--image`):

```bash
set -euo pipefail
rollback_dir=/opt/prompttune-releases/bootstrap-ROLLBACK_ID
(cd "$rollback_dir/image" && sha256sum -c backend-image.tar.sha256)
docker load --input "$rollback_dir/image/backend-image.tar"
image="$(cat "$rollback_dir/image/backend-image-id.txt")"
project="$(cat "$rollback_dir/compose-project.txt")"
COMPOSE_PROJECT_NAME="$project" bash "$rollback_dir/deployer/infra/scripts/deploy-prod.sh" \
  --image "$image" --preflight-only
COMPOSE_PROJECT_NAME="$project" bash "$rollback_dir/deployer/infra/scripts/deploy-prod.sh" \
  --image "$image"
```

The bundle is independent of the repository's later checkout. Its saved `.env`
is a private recovery copy, not part of the shareable image/evidence artifacts.
Preserve the previously approved support configuration too; this backend rollback
does not roll back independently updated databases, proxies or configuration.

### Rollback between audited releases

Once the preceding release already has an approved main-push artifact and a
compatible deployer, select it and repeat section 3's verification/loading
steps for that artifact, not for the failed release:

```bash
set -e
cd /path/to/PromptTune
git fetch origin main
git merge-base --is-ancestor PREVIOUS_APPROVED_SHA origin/main
git checkout --detach PREVIOUS_APPROVED_SHA
release_dir=/opt/prompttune-releases/PREVIOUS_APPROVED_SHA-ATTEMPT
cmp "$release_dir/image/backend-image-id.txt" "$release_dir/evidence/backend-image-id.txt"
(cd "$release_dir/image" && sha256sum -c backend-image.tar.sha256)
docker load --input "$release_dir/image/backend-image.tar"
image="$(cat "$release_dir/image/backend-image-id.txt")"
cd infra
./scripts/deploy-prod.sh --image "$image" --preflight-only
./scripts/deploy-prod.sh --image "$image"
```

This uses the previous audited image for both migrations and API startup and
checks the running ID. Do not rebuild the previous commit on the VPS: even that
checkout can resolve a different image. If its original artifact has been lost,
produce a new audited candidate and release decision instead of treating a
rebuild as an approved rollback. This MVP does not include automated off-box backups.

This leaves the repo at the previous approved commit in detached HEAD state.
For the next release, follow section 3 with the new approved artifact/commit.

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


## ANY-661 input-limit rollout

Before releasing the extension with the input counter, set
`PROMPT_INPUT_MAX_CHARS=30000` in the server's existing environment file and
redeploy the backend. An explicit old `8000` value overrides the new default.
Verify the deployed endpoint before releasing the extension:

```bash
curl -fsS https://api.anytoolai.store/v1/config | python3 -c 'import json, sys; assert json.load(sys.stdin)["prompt_input_max_chars"] == 30000'
```

The command must exit successfully. The default backend accepts 30,000 input
characters and rejects 30,001; custom limits remain configurable. Check the
weekly production `api_error` metric after rollout.

## ANY-825: monthly quota and email verification

The guarded `deploy-prod.sh --image` flow runs `alembic upgrade head` from the
approved image before starting the updated API (migration 008).
Existing installations receive 50 improvements on first access; renewal stays
anchored to their original server registration date, at Moscow midnight.
New installations call `POST /v1/installations` from `onInstalled`, independently
of analytics consent. The original local installation timestamp is retained for
offline retries (startup, a five-minute retry alarm, and before quota requests).
Registration is idempotent: an existing server anchor is never moved, and future
client timestamps are clamped to server time. Fresh-install timestamp persistence
is shared with quota callers and completes before they register or request quota,
even when handoff cleanup is still pending.
`FREE_REQ_PER_DAY` is obsolete; the monthly package is 50. `FREE_REQ_PER_MIN`
remains a separate per-installation minute throttle (default 10).
`FREE_REQ_PER_IP_MIN` is an additional shared per-IP throttle (default 50 requests
per 60 seconds), applied before quota reservation and the LLM call, even when
installation IDs change. It permits multiple installations behind NAT without
merging their monthly balances. Both throttles reject with temporary 429s and
consume no monthly units. Redis does not store monthly balances.

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`
and a separate random `EMAIL_CODE_SECRET` (at least 32 characters, identical on
all API workers). Use STARTTLS (`SMTP_STARTTLS=true`, `SMTP_SSL=false`, port 587)
or implicit TLS (`SMTP_SSL=true`, port 465). Plaintext SMTP is rejected.
Missing configuration or delivery failure returns a retryable error and grants no
bonus. Never log verification codes. SMTP delivery requires outbound connectivity
from the API container; SMTP traffic does not use the HTTP egress proxy.

Verification codes expire in 10 minutes, allow five guesses, and can be resent
once per minute. Request throttles additionally cover installation, IP and email.
Claims are permanent and unique per normalized email; do not purge the claim
ledger with analytics or reservation retention. Each installation can receive
only one bonus, even with a different address. Reinstalling and verifying an
already claimed address records verification without issuing another bonus.

The API exposes `remaining`, `total`, `next_reset_at`, `bonus_claimed`,
`email_verified`, `email`, `verification_pending` and `verification_resend_at`
from `/v1/limits` and improvement responses. `pending_improvements` reports active
reservations; `exhausted` becomes true only when availability is zero and no
current-period work remains pending. Zero held by in-flight work blocks new
requests without offering an email bonus. Email confirmation additionally returns
`email_bonus_outcome` (`awarded` or `already_claimed`), so a reused address is
explained without implying new credit. Pending email proof is restored from
these fields when the popup or sidebar is reopened.
Deprecated `per_day_*` fields mirror the monthly values during extension rollout;
new UI must use monthly semantics. Deploy the updated extension with the API.

Quota recovery selects results by their successful completion timestamp, while
normal editor restoration still uses editor creation order. Legacy results freeze
their last saved timestamp when restored so later edits do not become new successes.
A final hotkey result carries its quota to the new window through a one-shot local
handoff, bounded to five minutes and the current browser session. The offer is
shown from that response immediately; a separate server refresh does not delay
it or reopen it after dismissal.

Integration tests run only against an explicitly supplied disposable database:
`QUOTA_TEST_DATABASE_URL=postgresql+asyncpg://... pytest tests/test_quota.py tests/test_email_bonus.py`.
These tests recreate tables in that database. Never point them at production.
Both backend CI workflows set `QUOTA_TEST_DATABASE_URL` and
`ABUSE_TEST_REDIS_URL` to their disposable PostgreSQL/Redis services, so the real
quota, claim and request-throttle checks run in the required CI job.

Known pre-existing schema drift: `alembic check` also flags nullability differences
on old timestamp columns and missing standalone analytics indexes from earlier
migrations. Migration 008 creates only quota tables and matches their model
metadata; resolving the older drift is separate from ANY-825.
