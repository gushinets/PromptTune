# PromptTune

Browser extension for AI prompt improvement. Supports Chrome, Edge, and Firefox.

## Project Structure

- **extension/** — WXT + TypeScript + React browser extension
- **backend/** — FastAPI + LiteLLM + PostgreSQL + Redis
- **infra/** — Docker Compose configs, Caddy reverse proxy
- **docs/** — Project documentation
  - Metrics runbook: `docs/metrics.md`

## Quick Start

### Extension

```bash
cd extension
npm install
npm run dev        # WXT dev mode (Chrome)
npm run build      # Production build
```

#### Local backend profile (safe, without touching prod settings)

Use dedicated scripts that force localhost for this terminal run only:

```bash
cd extension
npm run dev:local-api
```

Also available:
- `npm run dev:local-api:firefox`
- `npm run build:local-api`
- `npm run zip:local-api`

Optional persistent local override (git-ignored):

```bash
cd extension
cp .env.local.example .env.local
```

This does not overwrite production values in code or CI.

#### Optimizer flow

The 360 × 600 popup and resizable sidebar share input, processing and result screens.
The popup adapts the 620px mockup to Chrome's 600px action-popup height limit;
the sidebar uses the available viewport height.
Ctrl/Cmd+Enter submits from the input screen. Cancel restores the original text and
aborts the pending request; processing steps illustrate waiting rather than report
provider progress. FastAPI refunds unfinished canceled requests in their original
quota windows. Deploy the backend changes together with the extension to enable
this refund behavior. An already completed improvement remains charged.

Each popup/sidebar request establishes a background-owned connection before submission.
The background aborts unfinished HTTP work when that connection disconnects, including
when its document closes ([Port lifetime](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#port-lifetime)).
The surface toggle is disabled during processing. If quota revalidation blocks a retry
or fails, the previous result and its actions are restored, including after reopening.
Saving that result retains its submitted original; edits remain in the input draft.

To check locally with `npm run dev:local-api`, exercise both modes, Cancel during
generation, Edit original, New, Copy/Insert/Save, and library search/deletion. Check
that `GET /v1/limits` returns the previous quota after cancellation. Resize the
sidebar with a long result and expand the changes list to check scrolling.

#### Improve selected text

Select text on a web page, right-click, and choose **Prompt Optimizer**.
The extension opens its optimizer in a separate window with exactly that selection
as the original prompt. Choose a mode on first use, then click Improve; opening
from the menu does not submit a request automatically. Previous results and the
library screen do not override the selection. Insert targets the originating tab
on supported AI sites; Copy is available for other pages. Switching to the side
panel transfers the current prompt/result and retains that source tab even when
another tab becomes active. In the separate optimizer window, New clears the
prompt session but keeps its originating browser target for Insert and switching
to the side panel. That standalone target is saved separately from the current
prompt binding, so New followed by a window reload retains it too. A normal
toolbar popup still uses the active tab after starting a new prompt. Saved source bindings carry a nonce in `storage.session`;
after a browser restart or extension reload they cannot resolve a reused tab ID.
The old result remains available to copy or save; New starts an unbound session
when reopening from the toolbar. Independent optimizer sessions keep separate
three-hour drafts, including each session’s audience mode and goal. Legacy goals
are validated against the restored mode before submission. Reopening restores the most recently created live session;
editing an older window or panel does not replace that choice. Drafts share a
1 MiB / 10-session budget; each save preserves the session being written and
evicts the least recently updated older drafts after a successful write. Under
quota pressure, failed replacement writes restore records removed for the retry. Selection and panel
handoff writes enforce this budget too, including after an upgrade, leaving room
for the 6 MiB library, 1 MiB pending-save reservation and temporary handoffs.
Valid legacy drafts without timestamps receive a timestamp before cleanup.
Expired drafts, including the legacy single-draft key, are removed by
startup/periodic cleanup. If the source tab closes, switching shows an error and
leaves the prompt available in the optimizer window. A failed handoff write
can close a panel only when it was created by that transition and still holds
that exact handoff or has not accepted any handoff yet. An already-open panel or
a panel that accepted another transfer is preserved with a notice; the new prompt
remains in the optimizer window. Ordinary toolbar popups
also send an explicit handoff, so switching surfaces retains their current session
even if another optimizer has a newer saved draft. Switching back from the panel
stores a one-shot snapshot for the next toolbar popup in the same browser window
(valid for five minutes).
Other panels and explicit selection launches do not consume that snapshot.
The panel retries a failed initial handoff read once, then offers a Retry action
without showing an unrelated draft. An ended source session has its own Insert
message explaining that Copy and New remain available.

The initial selection draft is committed before its temporary payload is removed.
If that write fails, the payload remains recoverable until its five-minute expiry.
A standalone optimizer URL retains its draft identity. Reloading restores only
that live session, including edits and results; it never selects another window’s
newer draft. Temporary popup/panel transfers carry the browser-session nonce in
addition to the window ID, so restarting the browser cannot replay them into a
window with a reused ID.

If neither the addressed draft nor its selection payload can be recovered, the window
shows an empty input and a recovery message instead of restoring another draft.
The empty failed launch is not autosaved; entering a new prompt starts normal
draft saving. Cleanup reads only optimizer records when key enumeration is
available, retaining a compatible fallback for older browsers.

Private/incognito selections are explicitly unsupported: selecting the menu item
opens an informational notice without storing or passing the selected text to the
optimizer. The app's draft storage is shared, so private text must not enter that flow.
Temporary selection and side-panel handoffs expire after five minutes. Expired or legacy entries
are deleted on installation/update, browser startup, and a one-minute cleanup alarm;
consumption still removes its own entry immediately. Browser suspension can delay
the cleanup callback, and expired payloads are rejected even before cleanup runs.

After installing an updated build, reload the extension to register the new menu
and its `contextMenus` and `alarms` permissions. To check manually in Chrome/Edge and Firefox,
select part of a paragraph on an ordinary page and in an editable field, including
multiline text and emoji. Verify the original field, Improve, and Copy. On a
supported AI site, also check Insert. Repeat with a saved result/library open and
with two selections opened in quick succession.

#### Run extension tests

```bash
cd extension
npm install
npm run test           # Fast test run
npm run test:coverage  # Coverage report in extension/coverage/
```

#### Build shareable zip files

```bash
cd extension
npm install
npm run zip          # Chrome / Edge package
npm run zip:firefox  # Firefox package
```

Generated files:

- `extension/.output/prompttune-extension-0.1.0-chrome.zip`
- `extension/.output/prompttune-extension-0.1.0-firefox.zip`
- `extension/.output/prompttune-extension-0.1.0-sources.zip` (generated with the Firefox build)

Notes:
- `npm run zip` builds the Chrome Manifest V3 package used by Chrome and Edge.
- If you need the extension to point at a non-default backend, set the relevant `VITE_*` env vars before running the zip command.
- Release-facing external URLs are documented in `docs/extension-external-destinations.md`.
  `VITE_CWS_REVIEW_URL` optionally overrides the default PromptOptimizer Chrome Web Store review page and must be a valid HTTPS URL.

### Backend

The extension supports two backends, controlled by the `VITE_BACKEND_MODE` env var:

| Mode | Description | Default target |
|------|-------------|----------------|
| `fastapi` | Calls the live FastAPI backend | `https://api.anytoolai.store/v1/improve` |
| `n8n` | Calls an n8n webhook override | `http://localhost:5678/webhook/improve-prompt` |

#### FastAPI (default)

The extension now defaults to the production backend:

```
VITE_BACKEND_MODE=fastapi
VITE_API_BASE_URL=https://api.anytoolai.store
```

To point the extension at a local FastAPI instance instead, override:

```bash
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -e "backend[dev]" # with dev dependencies (pytest, ruff)
# OR runtime only
pip install -e backend
cd backend
uvicorn app.main:app --reload
```

Backend dependency policy and validation:
- Use `backend/pyproject.toml` as the single source of truth for Python dependencies.
- Do not maintain `backend/requirements.in` or `backend/requirements.txt`.
- From `backend/`, run:
  - `pip install -e .` (runtime)
  - `pip install -e ".[dev]"` (dev/test/lint)
  - `pytest -q`
  - `ruff check .`
  - `ruff format --check .`
- One-time sanity check:
  - `pip install -e "backend[dev]"`
  - `python -c "from importlib.metadata import version; print(version('litellm'))"` (expected: `1.82.2`)

Then set env vars for the extension:

```
VITE_BACKEND_MODE=fastapi
VITE_API_BASE_URL=http://localhost:8000
```

Backend env vars for local FastAPI runs (create `backend/.env`, do not commit; copy the needed keys from `infra/.env.example` and switch `DATABASE_URL` / `REDIS_URL` to localhost):

```env
LLM_BACKEND=OPENROUTER        # or OPENAI
OPENROUTER_API_KEY=REPLACE_ME # required when LLM_BACKEND=OPENROUTER
# OPENAI_API_KEY=REPLACE_ME   # required when LLM_BACKEND=OPENAI
DATABASE_URL=postgresql+asyncpg://prompttune:prompttune@localhost:5432/prompttune
REDIS_URL=redis://localhost:6379/0
```

#### Prompt input length

In FastAPI mode, `GET /v1/config` exposes `prompt_input_max_chars` from the backend's
`PROMPT_INPUT_MAX_CHARS` setting. The extension uses it for the live counter and
blocks oversized requests before submission and analytics. Characters are counted
as Unicode code points, matching Python (an emoji counts as one character).

If configuration is unavailable, the extension retains the last known limit or
uses `DEFAULT_PROMPT_INPUT_MAX_CHARS` (30 000). The backend and deployment template
also default to 30 000. Existing deployments must update any explicit
`PROMPT_INPUT_MAX_CHARS=8000` override to `30000` before releasing the extension.
Open panels refresh the displayed limit on focus and when becoming visible.
Oversized originals also disable Save to Library while keeping Copy and Insert available.
`GET /v1/limits` continues to return only request quotas.
The n8n profile retains its existing behavior: it does not fetch FastAPI configuration
or apply its input-length limit to improvement or local library saves.

#### Local library storage

The library retains the newest entries up to 200 records or 6 MiB of serialized
UTF-8 data, whichever is reached first. Older entries are pruned to leave room
for drafts, settings, and analytics. This storage budget also applies in n8n mode.

Before synchronizing to FastAPI, the complete payload is reserved locally in a
separate staging area (up to 1 MiB across in-flight saves). A failed reservation
shows an error and does not send a remote save. Only a successful server response
moves the reserved entry into the library and prunes older records. A failure
removes its own reservation without restoring snapshots or losing concurrent
saves/deletions. Shared Web Locks protect mutations; per-save leases keep live
reservations and reclaim those left by closed contexts on the next save. Older
browsers without Web Locks reclaim abandoned staging entries after 30 minutes. FastAPI saves refresh
and validate the input limit immediately before the POST. Older configuration
responses cannot replace a newer configuration or a limit received in a 422.

#### n8n override

Requires an n8n instance with the "Prompt Improver API" workflow active.

```bash
cd extension
npm run dev
```

Env vars:

```
VITE_BACKEND_MODE=n8n
VITE_N8N_WEBHOOK_URL=http://localhost:5678/webhook/improve-prompt
```

Notes:
- The backend uses **server-owned provider keys**; the extension does **not** send provider keys in request headers.
- The extension automatically includes `client=\"extension\"` and `client_version=<manifest version>` on `/v1/improve` calls.
- The built extension manifest includes `https://api.anytoolai.store/*` in `host_permissions`.

##### Smoke test (local)
- Start Postgres + Redis (or use Docker via `infra/`).
- Start backend and open `http://localhost:8000/docs`.
- Call `GET /healthz` and `GET /readyz`.
- Call `POST /v1/improve` with JSON body including `text`, `installation_id`, and `client` (Swagger will validate).
- Run the extension in dev mode and click **Improve** in the popup; it should return improved text.

### Full Stack (Docker)

```bash
cd infra
make dev-up-d      # Starts api, postgres, redis for local development
make dev-down      # Stops the local dev stack
```

For VPS deployment behind Caddy at `api.anytoolai.store`, use the runbook in `docs/deployment.md`.
