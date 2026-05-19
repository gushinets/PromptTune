export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "https://api.anytoolai.store";

export type BackendMode = "n8n" | "fastapi";

export const BACKEND_MODE: BackendMode =
  (import.meta.env.VITE_BACKEND_MODE as BackendMode) ?? "fastapi";

export const N8N_WEBHOOK_URL =
  import.meta.env.VITE_N8N_WEBHOOK_URL ?? "http://localhost:5678/webhook/improve-prompt";
export const ANALYTICS_ENABLED = (import.meta.env.VITE_ANALYTICS_ENABLED ?? "true") === "true";

export const STORAGE_KEYS = {
  INSTALLATION_ID: "installation_id",
  LIBRARY: "library",
  AUDIENCE_MODE: "audience_mode",
  INSTALL_AT: "install_at",
  FIRST_PROMPT_SUBMITTED_AT: "first_prompt_submitted_at",
  FIRST_RESULT_COPIED_AT: "first_result_copied_at",
  TOTAL_USES: "total_uses",
  ANALYTICS_QUEUE: "analytics_queue",
  ANALYTICS_SESSION_STATE: "analytics_session_state",
} as const;

export const LIMITS = {
  MAX_LIBRARY_ENTRIES: 200,
} as const;

export const FEATURES = {
  OPEN_AND_PASTE: false, // V2 — flip to true when ready
} as const;
