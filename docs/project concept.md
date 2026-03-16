Below is the **full English translation** of the concept. I preserved the **same structure and meanings** without changing anything.

---

# 1) Product goal

Build a cross-browser **Prompt Enhancer** extension:

- **V1 (MVP):** a popup interface: the user manually enters text → clicks “Improve” → gets an improved prompt → can **Copy improved**, **Save to Library**, **Open & Paste** to a selected website.
- **V1+ (MVP UI upgrade):** in the popup there is a button that **toggles the interface** between **popup** and **side panel mode** (a side panel), so the UI does not cover page content.
- **V2:** on supported websites, add a **toolbar chip next to the composer** (“Improve” in one click), working with the **active field**.

The backend (FastAPI) accepts the request, uses LiteLLM to call a chosen LLM, and returns the improved text. In the MVP there is **no login**. Requests are limited to **50/day** and **10/min**. Prompt texts are stored in **Postgres**.

---

# 2) Supported browsers and publishing

- Immediately: **Chrome + Edge + Firefox**
- Later: **Safari**
- Publishing: **must be published in stores** (Chrome Web Store, Edge Add-ons, AMO; Safari via the App Store workflow)

---

# 3) Core user scenarios

## 3.1. V1: Popup → Improve → Copy / Save / Open & Paste

1. The user opens the extension popup.
2. Manually enters the source text.
3. Clicks **Improve** → gets the improved version.
4. Can:
   - **Copy improved**
   - **Save to Library** (locally)
   - Click a website button (icon) → **Open & Paste** (open the site and insert the improved prompt into the input field)

## 3.2. V1: Toggle Popup ⇄ Side panel

- In the popup there is a button “to panel”.
  - Clicking it moves the UI to **Side panel mode**.

- In the side panel there is a button “to popup”.
  - Clicking it returns the UI to popup.

Notes:

- The **panel side (left/right)** depends on the browser/user settings.
- In **Side panel mode**, clicking the extension icon **opens the panel**, and the **popup is not available** by clicking the icon (you can return only using the “to popup” button).

State (draft) is preserved when switching:

- `Original`, `Improved`, last UI state.

## 3.3. V2: Embedded toolbar chip next to the composer

1. The user is on a website (ChatGPT/Claude/etc.) and focuses the input field.
2. Clicks the **Improve** button on the chip next to it.
3. The active field text is sent to the backend → improved text is returned.
4. The improved text **replaces the active field text**.

Additionally:

- **Hotkeys**: improve the active field without clicking.

---

# 4) UI and functional requirements

## 4.1. Popup (V1)

Elements:

- textarea: **Original prompt**
- textarea: **Improved prompt**
- buttons:
  - **Improve**
  - **Copy improved** (mandatory for MVP)
  - **Save to Library** (local)
  - **Open & Paste**: buttons with website icons

Additionally (recommended for MVP):

- “loading” indicator
- error display (rate limit / network / provider error)

## 4.2. Side panel mode (V1+)

- Same UI and features as in the popup.
- Toggle button “to popup”.
- In panel mode, clicking the extension icon opens the panel.

## 4.3. Toolbar chip next to the input field (V2)

- Minimal UI: an icon/button ✨ Improve + tooltip
- The button is attached to the composer container (not an overlay inside the field)
- Works only with the **active field** (the last focused element)
- Fallback: if the composer is not found, show a hint “Focus the input field”.

## 4.4. Prompt library (MVP)

- In MVP the library is stored **locally** in the extension `storage.local`.
- Entity:
  - `id`, `createdAt`, `original`, `improved`, `site?`, `title?`, `tags?`

- Minimal operations:
  - Save
  - List
  - Delete (optional)
  - Search (optional, can be later)

---

# 5) Extension architecture

## 5.1. Components

1. **Popup UI** (popup page)
2. **Side panel UI** (panel/sidebar page)
3. **Background** (service worker / background script)
4. **Content scripts** (injection into sites for V2 and for Open & Paste)
5. **Shared modules**:
   - API client
   - Draft store (storage sync)
   - Site adapter registry
   - Clipboard helper
   - Types/shared constants

## 5.2. Draft Store and sync between popup/panel

In `storage.local`:

- `ui_mode`: `"popup" | "sidepanel"`
- `draft`: `{ original, improved, updatedAt }`
- `installation_id`
- `library`: array of entries

Rule:

- Any change to `original/improved` → debounce write to storage.
- Popup and Panel read the draft on startup and update the UI.

## 5.3. UI mode switching (Popup ⇄ Side panel)

- Switching is triggered only by **user gesture** (clicking the button).
- On transition:
  1. save draft
  2. set `ui_mode`
  3. background applies the mode:
     - Side panel mode: action opens the panel, popup is disabled
     - Popup mode: action opens the popup

## 5.4. Hotkeys

- Command: “Improve active field”
- Logic:
  - background catches the hotkey → sends a message to the content script in the active tab → content script improves and inserts back.

---

# 6) Site Adapters (extensibility of the site list)

Goal: add new sites quickly and safely.

## 6.1. Adapter interface

- `match(url/host): boolean`
- `findComposerContainer(): HTMLElement | null`
- `getActiveField(): HTMLElement | null`
- `getText(field): string`
- `setText(field, text): void` (and mandatory `dispatchEvent('input')`)
- `mountToolbar(container): void`

## 6.2. Fallback (for new/broken sites)

If the adapter cannot find the composer:

- get active field from `document.activeElement`
- support:
  - `textarea` / `input[type=text]`
  - `contenteditable`

- if not supported — show a notification “Focus the prompt field”.

---

# 7) Open & Paste (V1)

Mechanics:

- The user clicks a website button in the popup.
- Background:
  1. opens a new tab to the target domain
  2. waits for load
  3. sends a message to the content script: `PASTE_TEXT(improved)`

- Content script:
  - finds the input field on the website (via adapter/selectors)
  - inserts the text and triggers input events

---

# 8) Backend concept (FastAPI + LiteLLM)

## 8.1. API

### `POST /v1/improve`

Input:

- `text: string`
- `installation_id: string`
- `site?: string`
- `page_url?: string`
- `client_ts?: number` (optional)

Output:

- `request_id: string`
- `improved_text: string`
- (optional) `limits`: remaining minute/day limits

### (Optional) `POST /v1/feedback`

- feedback (like/dislike), reason, request_id

## 8.2. LLM layer

- LiteLLM calls the chosen provider/model.
- System prompt is fixed for MVP: “improve, make clearer, more structured, without losing meaning”.
- No streaming.

---

# 9) Data storage (Postgres)

You decided to store prompt texts on the server.

## 9.1. Schema (MVP)

### `installations`

- `installation_id` (PK)
- `created_at`, `last_seen_at`
- (optional) `first_user_agent`, `first_ip` — **if you decide**, this impacts privacy

### `prompt_improvements`

- `id` (PK, uuid)
- `installation_id` (FK)
- `created_at`
- `site`, `page_url`
- `original_text` (TEXT)
- `improved_text` (TEXT)
- `model`, `provider`
- `latency_ms`
- `status` (ok/error)
- indexes on `installation_id, created_at`

---

# 10) Limits and abuse protection (Redis)

Requirement: **50 requests/day** and **10 requests/min**.

## 10.1. Rate limit strategy

Counters in Redis:

- by `installation_id`
- by IP (as an additional protection layer)

Keys:

- `rl:inst:min:{installation_id}:{minute_bucket}`
- `rl:inst:day:{installation_id}:{yyyy-mm-dd}`
- `rl:ip:min:{ip}:{minute_bucket}`
- `rl:ip:day:{ip}:{yyyy-mm-dd}`

Rule:

- if **any** limit is exceeded → 429.

TTL:

- minute keys: several minutes
- day keys: several days

## 10.2. Configurability of limits

MVP option:

- store limits in config (env) + ability to change without extension release via:
  - `GET /v1/config` (reads values from DB/cache) **or**
  - `settings` table in Postgres + cache in Redis
    Later (with subscription): limits per plan.

## 10.3. Additional measures (simple and effective)

- Limit input `text` length (e.g., 8k characters)
- Limit error frequency from an IP (temporary ban)
- Reverse proxy (Caddy/Nginx) in front of FastAPI:
  - TLS
  - coarse RPS limiting

- Logs by `request_id` for investigations

---

# 11) Deployment on a single VPS (MVP)

Docker Compose services:

- `api` (FastAPI)
- `redis`
- `postgres`
- `proxy` (Caddy or Nginx) — TLS + proxying

Observability (minimum):

- structured logs
- latency / error rate metrics (can be later)

---

# 12) Recommended extension stack

- **WXT + TypeScript + webextension-polyfill**
- UI: vanilla or React/Preact (your choice)
- Storage: `storage.local` (MVP)
- Later for a large library: IndexedDB (Dexie)

---

# 13) Repository structure (example)

```plaintext
/extension
  /entrypoints
    /popup
    /sidepanel
    /background
    /content
  /shared
    apiClient.ts
    draftStore.ts
    libraryStore.ts
    messaging.ts
  /adapters
    chatgpt.ts
    claude.ts
    perplexity.ts
    groq.ts
    deepseek.ts

/backend
  /app
    /api
    /services
    /db
    /models
  alembic/

/infra
  docker-compose.yml
  caddy/ (or nginx/)
```

---

# 14) Roadmap by versions

## MVP (V1)

- Popup UI: Improve / Copy / Save / Open & Paste
- Local library (storage.local)
- Backend /v1/improve + LiteLLM
- Postgres prompt storage
- Redis rate limit 10/min + 50/day
- Publishing Chrome + Edge + Firefox

## MVP UI upgrade (V1+)

- Toggle popup ⇄ side panel
- Side panel mode is off by default; enabled via a button
- In side panel mode popup does not open by clicking the icon

## V2

- Toolbar chip next to the composer on websites
- Improve active field + hotkeys
- Extensible site adapter system

## V3 (later)

- Accounts/subscription/plans
- Personal improvement modes (longer/structure/goals)
- Server-side library, cross-device sync
- Safari

---

# 15) Definition of Done (key criteria)

**Popup/Panel**

- Draft is not lost when switching.
- Copy improved works.
- Save to Library writes to the local library.

**Open & Paste**

- Opens the selected site and inserts improved into the input field (for supported adapters).

**V2**

- Toolbar appears on supported sites.
- Improve changes **only the active field**.
- Hotkey works on the active tab.

**Backend**

- Limits 10/min and 50/day are enforced.
- Requests and texts are saved to Postgres.
- Stable errors/429 are returned correctly.

---
