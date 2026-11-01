import { countPromptCharacters, parseInputLengthError } from "./prompt-length";
import {
  API_BASE_URL,
  N8N_WEBHOOK_URL,
  BACKEND_MODE,
  DEFAULT_PROMPT_INPUT_MAX_CHARS,
} from "./constants";
import type {
  ImproveRequest,
  ImproveResponse,
  PromptInputLimit,
  SavePromptRequest,
  SavePromptResponse,
} from "./types";
import type { AnalyticsEventOut } from "./analytics-types";

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    const safeDetail = detail.trim() || "Request failed";
    super(`API ${status}: ${safeDetail}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = safeDetail;
  }
}

function extractErrorDetail(raw: string, fallback: string): string {
  const text = raw.trim();
  if (!text) return fallback;

  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail.trim();
    }
  } catch {
    // ignore non-JSON responses and surface plain text as-is
  }

  return text;
}

async function post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const rawDetail = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, extractErrorDetail(rawDetail, res.statusText));
  }

  return res.json();
}

async function get<TRes>(
  path: string,
  query: Record<string, string>,
  signal?: AbortSignal,
): Promise<TRes> {
  const url = new URL(`${API_BASE_URL}${path}`);
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), { method: "GET", ...(signal ? { signal } : {}) });
  if (!res.ok) {
    const rawDetail = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, extractErrorDetail(rawDetail, res.statusText));
  }
  return res.json();
}

async function improveViaN8n(req: ImproveRequest): Promise<ImproveResponse> {
  const res = await fetch(N8N_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: req.text, goal: req.goal }),
  });

  if (!res.ok) {
    const rawDetail = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, extractErrorDetail(rawDetail, res.statusText));
  }

  const data: { improved_prompt: string; model: string } = await res.json();
  return {
    request_id: crypto.randomUUID(),
    improved_text: data.improved_prompt,
  };
}

let promptInputMaxChars: number = DEFAULT_PROMPT_INPUT_MAX_CHARS;
let promptLimitFetchedAt: number | null = null;
let promptLimitFallback = true;
let promptLimitRevision = 0;
let pendingPromptLimit: { revision: number; promise: Promise<PromptInputLimit> } | null = null;

function rememberInputLengthError(error: unknown): void {
  if (!(error instanceof ApiError) || error.status !== 422) return;
  const limit = parseInputLengthError(error.detail);
  if (limit === null) return;
  promptLimitRevision++;
  promptInputMaxChars = limit;
  promptLimitFallback = false;
  promptLimitFetchedAt = Date.now();
}
const PROMPT_LIMIT_CACHE_MS = 60_000;
const PROMPT_CONFIG_TIMEOUT_MS = 3_000;

export const apiClient = {
  async promptInputLimit(refresh = false): Promise<PromptInputLimit> {
    if (BACKEND_MODE !== "fastapi") return { max_chars: promptInputMaxChars, fallback: true };
    if (!refresh && pendingPromptLimit?.revision === promptLimitRevision)
      return pendingPromptLimit.promise;
    if (
      !refresh &&
      promptLimitFetchedAt !== null &&
      Date.now() - promptLimitFetchedAt < PROMPT_LIMIT_CACHE_MS
    ) {
      return { max_chars: promptInputMaxChars, fallback: promptLimitFallback };
    }
    const revision = ++promptLimitRevision;
    const lookup = (async (): Promise<PromptInputLimit> => {
      let fallback = true;
      let nextLimit = promptInputMaxChars;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROMPT_CONFIG_TIMEOUT_MS);
      try {
        const config = await get<{ prompt_input_max_chars?: number }>(
          "/v1/config",
          {},
          controller.signal,
        );
        const limit = config.prompt_input_max_chars;
        if (typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0) {
          nextLimit = limit;
          fallback = false;
        }
      } catch {
        // Older, unavailable or stalled servers: retain the last known limit.
      } finally {
        clearTimeout(timeout);
      }
      if (revision === promptLimitRevision) {
        promptInputMaxChars = nextLimit;
        promptLimitFetchedAt = Date.now();
        promptLimitFallback = fallback;
      } else if (pendingPromptLimit && pendingPromptLimit.revision > revision) {
        return pendingPromptLimit.promise;
      }
      return { max_chars: promptInputMaxChars, fallback: promptLimitFallback };
    })();
    pendingPromptLimit = { revision, promise: lookup };
    try {
      return await lookup;
    } finally {
      if (pendingPromptLimit?.promise === lookup) pendingPromptLimit = null;
    }
  },

  validateImproveInput(text: string): void {
    if (BACKEND_MODE !== "fastapi") return;
    if (countPromptCharacters(text) > promptInputMaxChars) {
      throw new ApiError(
        422,
        `Input text exceeds maximum length of ${promptInputMaxChars} characters.`,
      );
    }
  },

  async improve(req: ImproveRequest): Promise<ImproveResponse> {
    if (BACKEND_MODE === "n8n") {
      return improveViaN8n(req);
    }
    await apiClient.promptInputLimit();
    apiClient.validateImproveInput(req.text);
    try {
      return await post<ImproveRequest, ImproveResponse>("/v1/improve", req);
    } catch (error) {
      rememberInputLengthError(error);
      throw error;
    }
  },

  async savePrompt(req: SavePromptRequest): Promise<SavePromptResponse> {
    if (BACKEND_MODE === "fastapi") {
      await apiClient.promptInputLimit(true);
      apiClient.validateImproveInput(req.original_text);
    }
    try {
      return await post<SavePromptRequest, SavePromptResponse>("/v1/prompts", req);
    } catch (error) {
      if (BACKEND_MODE === "fastapi") rememberInputLengthError(error);
      throw error;
    }
  },

  limits(installation_id: string): Promise<{
    per_minute_remaining: number;
    per_day_remaining: number;
    per_minute_total: number;
    per_day_total: number;
  }> {
    if (BACKEND_MODE !== "fastapi") {
      return Promise.resolve({
        per_minute_remaining: 0,
        per_day_remaining: 0,
        per_minute_total: 0,
        per_day_total: 0,
      });
    }

    return get("/v1/limits", { installation_id });
  },

  events(events: AnalyticsEventOut[]): Promise<{
    accepted: number;
    deduplicated: number;
    rejected: Array<{ event_id: string; reason: string }>;
  }> {
    if (BACKEND_MODE !== "fastapi") {
      return Promise.resolve({ accepted: 0, deduplicated: 0, rejected: [] });
    }
    return post("/v1/events", { events });
  },
};
