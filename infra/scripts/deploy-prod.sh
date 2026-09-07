#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd "${INFRA_DIR}/.." && pwd)"
ENV_FILE="${INFRA_DIR}/.env"
COMPOSE_FILES=(-f docker-compose.base.yml -f docker-compose.prod.yml)

MIN_FREE_MB="${MIN_FREE_MB:-1024}"
BASE_URL="${BASE_URL:-https://api.anytoolai.store}"
LIMITS_INSTALLATION_ID="${LIMITS_INSTALLATION_ID:-test-installation}"
CORS_SMOKE_ORIGIN="${CORS_SMOKE_ORIGIN:-chrome-extension://fbageijibmjblopdbgpdcpkojhnjjbpe}"
PRECHECK_ONLY=false
SKIP_SMOKE=false

log() {
  printf '[deploy] %s\n' "$*"
}

warn() {
  printf '[deploy] WARNING: %s\n' "$*" >&2
}

die() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-prod.sh [options]

Deploy the current PromptTune production checkout with preflight checks.

Options:
  --preflight-only       Run validation checks without changing containers
  --skip-smoke           Skip HTTP verification after deploy
  --base-url URL         Override the smoke-test base URL
  --min-free-mb N        Minimum free space required on root/docker filesystems
  -h, --help             Show this help text

Environment overrides:
  BASE_URL               Default: https://api.anytoolai.store
  MIN_FREE_MB            Default: 1024
  LIMITS_INSTALLATION_ID Default: test-installation
  CORS_SMOKE_ORIGIN      Default: PromptOptimizer Chrome extension origin
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

compose() {
  (
    cd "${INFRA_DIR}"
    docker compose "${COMPOSE_FILES[@]}" "$@"
  )
}

read_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -n1 | tr -d '\r'
}

require_env_key() {
  local key="$1"
  local value
  value="$(read_env_value "${key}")"
  [[ -n "${value}" ]] || die "${ENV_FILE} is missing required ${key}"
}

check_allowed_origins() {
  local allowed_origins
  local origin
  local smoke_origin_found=false
  local -a origins

  allowed_origins="$(read_env_value "ALLOWED_ORIGINS")"
  [[ -n "${allowed_origins}" ]] || die "${ENV_FILE} is missing required ALLOWED_ORIGINS"
  [[ "${allowed_origins}" != "*" ]] || die "ALLOWED_ORIGINS must list explicit origins; wildcard (*) is not allowed"

  IFS=',' read -r -a origins <<< "${allowed_origins}"
  for origin in "${origins[@]}"; do
    origin="${origin#"${origin%%[![:space:]]*}"}"
    origin="${origin%"${origin##*[![:space:]]}"}"
    [[ "${origin}" != "*" ]] || die "ALLOWED_ORIGINS must list explicit origins; wildcard (*) is not allowed"
    if [[ "${origin}" == "${CORS_SMOKE_ORIGIN}" ]]; then
      smoke_origin_found=true
    fi
  done

  [[ "${smoke_origin_found}" == "true" ]] || die "ALLOWED_ORIGINS must include CORS_SMOKE_ORIGIN (${CORS_SMOKE_ORIGIN})"
}

check_free_space() {
  local path="$1"
  local label="$2"
  local available_mb

  available_mb="$(df -Pm "${path}" | awk 'NR==2 {print $4}')"
  [[ -n "${available_mb}" ]] || die "Unable to determine free space for ${label}"

  if (( available_mb < MIN_FREE_MB )); then
    die "${label} only has ${available_mb}MB free; need at least ${MIN_FREE_MB}MB before deploy"
  fi

  log "${label} has ${available_mb}MB free"
}

wait_for_service_ready() {
  local service="$1"
  local status
  local container_id
  local attempt

  container_id="$(compose ps -q "${service}")"
  [[ -n "${container_id}" ]] || die "Could not find container for service ${service}"

  for attempt in $(seq 1 30); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}")"
    case "${status}" in
      healthy|running)
        log "${service} is ${status}"
        return 0
        ;;
      unhealthy|dead|exited)
        die "${service} entered bad state: ${status}"
        ;;
    esac
    sleep 2
  done

  die "${service} did not become ready in time"
}

wait_for_http_200() {
  local url="$1"
  local label="$2"
  local code
  local attempt

  for attempt in $(seq 1 30); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${url}" || true)"
    if [[ "${code}" == "200" ]]; then
      log "${label} returned 200"
      return 0
    fi
    sleep 2
  done

  die "${label} did not return 200 from ${url}"
}

check_env_file() {
  [[ -f "${ENV_FILE}" ]] || die "Expected env file at ${ENV_FILE}; copy .env.example first"

  require_env_key "POSTGRES_PASSWORD"
  require_env_key "DATABASE_URL"
  require_env_key "LLM_BACKEND"
  require_env_key "INSTALLATION_ID_SALT"
  require_env_key "IP_SALT"
  require_env_key "NTFY_TOPIC"
  check_allowed_origins

  case "$(read_env_value "LLM_BACKEND")" in
    OPENAI)
      require_env_key "OPENAI_API_KEY"
      ;;
    OPENROUTER)
      require_env_key "OPENROUTER_API_KEY"
      ;;
    *)
      die "LLM_BACKEND must be OPENAI or OPENROUTER; found: $(read_env_value "LLM_BACKEND")"
      ;;
  esac
}

check_cors_preflight() {
  local path="$1"
  local method="$2"
  local origin="$3"
  local expected_status="$4"
  local expected_allow_origin="$5"
  local response_headers
  local status
  local allow_origin
  local attempt

  for attempt in 1 2 3; do
    if response_headers="$(curl -sS --connect-timeout 5 --max-time 15 \
      -D - -o /dev/null -X OPTIONS "${BASE_URL}${path}" \
      -H "Origin: ${origin}" \
      -H "Access-Control-Request-Method: ${method}" \
      -H "Access-Control-Request-Headers: content-type")"; then
      break
    fi
    if [[ "${attempt}" == "3" ]]; then
      die "CORS preflight ${method} ${path} for ${origin} failed after 3 attempts"
    fi
    sleep 1
  done
  status="$(printf '%s\n' "${response_headers}" | awk 'NR == 1 {print $2}')"
  allow_origin="$(printf '%s\n' "${response_headers}" | awk 'tolower($1) == "access-control-allow-origin:" {gsub(/\r/, "", $2); print $2; exit}')"

  [[ "${status}" == "${expected_status}" ]] || die "CORS preflight ${method} ${path} for ${origin} returned ${status}; expected ${expected_status}"
  [[ "${allow_origin}" == "${expected_allow_origin}" ]] || die "CORS preflight ${method} ${path} returned allow-origin '${allow_origin}'; expected '${expected_allow_origin}'"
}

print_git_context() {
  local branch
  local commit

  if ! git -C "${REPO_DIR}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 0
  fi

  branch="$(git -C "${REPO_DIR}" rev-parse --abbrev-ref HEAD)"
  commit="$(git -C "${REPO_DIR}" rev-parse --short HEAD)"
  log "Deploying repo checkout ${branch}@${commit}"

  if [[ -n "$(git -C "${REPO_DIR}" status --short)" ]]; then
    warn "Working tree has uncommitted changes; this deploy uses the current checkout exactly as-is"
  fi
}

run_preflight() {
  local docker_root

  [[ "${MIN_FREE_MB}" =~ ^[0-9]+$ ]] || die "MIN_FREE_MB must be an integer"

  log "Running preflight checks"
  print_git_context
  check_env_file

  require_cmd docker
  require_cmd df
  require_cmd awk
  require_cmd curl
  docker info >/dev/null 2>&1 || die "Docker daemon is not available"
  docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is not available"

  check_free_space "/" "Root filesystem"

  docker_root="$(docker info --format '{{.DockerRootDir}}')"
  if [[ -n "${docker_root}" ]]; then
    check_free_space "${docker_root}" "Docker root"
  fi

  log "Validating production compose config"
  compose config --quiet
  log "Preflight checks passed"
}

run_deploy() {
  local start_caddy

  log "Starting postgres and redis"
  compose up -d postgres redis

  wait_for_service_ready "postgres"
  wait_for_service_ready "redis"

  log "Building api image"
  compose build api

  log "Applying database migrations"
  compose run --rm --no-deps api alembic upgrade head

  start_caddy="$(read_env_value "PROMPTTUNE_START_CADDY")"
  if [[ "${start_caddy:-true}" == "false" ]]; then
    log "Starting api and egress services without PromptTune caddy"
    compose up -d egress-lb egress-alert api
  else
    log "Starting api, egress services, and caddy"
    compose up -d egress-lb egress-alert api caddy
  fi

  log "Current production container state"
  compose ps
}

run_smoke_checks() {
  local limits_url
  local path
  local method

  require_cmd curl
  BASE_URL="${BASE_URL%/}"
  limits_url="${BASE_URL}/v1/limits?installation_id=${LIMITS_INSTALLATION_ID}"

  log "Running live smoke checks against ${BASE_URL}"
  wait_for_http_200 "${BASE_URL}/healthz" "healthz"
  wait_for_http_200 "${BASE_URL}/readyz" "readyz"
  wait_for_http_200 "${limits_url}" "limits endpoint"
  while read -r path method; do
    check_cors_preflight "${path}" "${method}" "${CORS_SMOKE_ORIGIN}" "200" "${CORS_SMOKE_ORIGIN}"
    check_cors_preflight "${path}" "${method}" "https://unrelated.example" "400" ""
  done <<'EOF'
/v1/improve POST
/v1/limits GET
/v1/prompts POST
/v1/events POST
EOF
  log "CORS preflight checks passed"
  log "Smoke checks passed"
}

cleanup_docker_artifacts() {
  log "Pruning dangling Docker images and build cache"
  docker image prune -f >/dev/null
  docker builder prune -f >/dev/null
  log "Docker cleanup complete"
}

while (($# > 0)); do
  case "$1" in
    --preflight-only)
      PRECHECK_ONLY=true
      ;;
    --skip-smoke)
      SKIP_SMOKE=true
      ;;
    --base-url)
      shift
      [[ $# -gt 0 ]] || die "--base-url requires a value"
      BASE_URL="$1"
      ;;
    --min-free-mb)
      shift
      [[ $# -gt 0 ]] || die "--min-free-mb requires a value"
      MIN_FREE_MB="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
  shift
done

run_preflight

if [[ "${PRECHECK_ONLY}" == "true" ]]; then
  log "Preflight-only mode complete"
  exit 0
fi

run_deploy

if [[ "${SKIP_SMOKE}" != "true" ]]; then
  run_smoke_checks
fi

cleanup_docker_artifacts

log "Production deploy complete"
