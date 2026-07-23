export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "https://api.anytoolai.store";

export type BackendMode = "n8n" | "fastapi";

const DEFAULT_WELCOME_PAGE_URL = "https://anytoolai-welcome.netlify.app/prompt-optimizer/";
const DEFAULT_FEEDBACK_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSd7Q5SmtvSEuxBDvZRvtNMPojqH7k69olXajFSZGOO4-EZ7CQ/viewform?usp=dialog";

function getHttpsUrl(rawUrl: string | undefined, fallback: string): string {
  try {
    const parsedUrl = new URL(rawUrl ?? fallback);
    if (parsedUrl.protocol !== "https:") {
      return fallback;
    }
    return parsedUrl.toString();
  } catch {
    return fallback;
  }
}

function getOptionalHttpsUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;

  try {
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol !== "https:") {
      return null;
    }
    return parsedUrl.toString();
  } catch {
    return null;
  }
}

export const BACKEND_MODE: BackendMode =
  (import.meta.env.VITE_BACKEND_MODE as BackendMode) ?? "fastapi";

export const N8N_WEBHOOK_URL =
  import.meta.env.VITE_N8N_WEBHOOK_URL ?? "http://localhost:5678/webhook/improve-prompt";
export const ANALYTICS_ENABLED = (import.meta.env.VITE_ANALYTICS_ENABLED ?? "true") === "true";
export const WELCOME_PAGE_URL = getHttpsUrl(
  import.meta.env.VITE_WELCOME_PAGE_URL,
  DEFAULT_WELCOME_PAGE_URL,
);
export const FEEDBACK_URL = getHttpsUrl(import.meta.env.VITE_FEEDBACK_URL, DEFAULT_FEEDBACK_URL);
export const CWS_REVIEW_URL = getOptionalHttpsUrl(import.meta.env.VITE_CWS_REVIEW_URL);

export const STORAGE_KEYS = {
  INSTALLATION_ID: "installation_id",
  LIBRARY: "library",
  AUDIENCE_MODE: "audience_mode",
  POPUP_SESSION_DRAFT: "popup_session_draft",
  INSTALL_AT: "install_at",
  FIRST_PROMPT_SUBMITTED_AT: "first_prompt_submitted_at",
  FIRST_RESULT_COPIED_AT: "first_result_copied_at",
  TOTAL_USES: "total_uses",
  ANALYTICS_QUEUE: "analytics_queue",
  ANALYTICS_SESSION_STATE: "analytics_session_state",
} as const;

export const LIMITS = {
  MAX_LIBRARY_ENTRIES: 200,
  POPUP_SESSION_TTL_MS: 3 * 60 * 60 * 1000,
} as const;

export const FEATURES = {
  OPEN_AND_PASTE: false, // V2 — flip to true when ready
} as const;
