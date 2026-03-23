export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "https://api.anytoolai.store";

export type BackendMode = "n8n" | "fastapi";

export const BACKEND_MODE: BackendMode =
  (import.meta.env.VITE_BACKEND_MODE as BackendMode) ?? "fastapi";

export const N8N_WEBHOOK_URL =
  import.meta.env.VITE_N8N_WEBHOOK_URL ?? "http://localhost:5678/webhook/improve-prompt";

export const STORAGE_KEYS = {
  INSTALLATION_ID: "installation_id",
  LIBRARY: "library",
} as const;

export const LIMITS = {
  MAX_TEXT_LENGTH: 8000,
  MAX_LIBRARY_ENTRIES: 200,
} as const;

export const FEATURES = {
  OPEN_AND_PASTE: false, // V2 — flip to true when ready
} as const;
