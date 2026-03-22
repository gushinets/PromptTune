import { API_BASE_URL, N8N_WEBHOOK_URL, BACKEND_MODE } from "./constants";
import type {
  ImproveRequest,
  ImproveResponse,
  SavePromptRequest,
  SavePromptResponse,
} from "./types";

async function post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${detail}`);
  }

  return res.json();
}

async function get<TRes>(path: string, query: Record<string, string>): Promise<TRes> {
  const url = new URL(`${API_BASE_URL}${path}`);
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${detail}`);
  }
  return res.json();
}

async function improveViaN8n(req: ImproveRequest): Promise<ImproveResponse> {
  const res = await fetch(N8N_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: req.text }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${detail}`);
  }

  const data: { improved_prompt: string; model: string } = await res.json();
  return {
    request_id: crypto.randomUUID(),
    improved_text: data.improved_prompt,
  };
}

export const apiClient = {
  improve(req: ImproveRequest): Promise<ImproveResponse> {
    if (BACKEND_MODE === "n8n") {
      return improveViaN8n(req);
    }
    return post("/v1/improve", req);
  },

  savePrompt(req: SavePromptRequest): Promise<SavePromptResponse> {
    return post("/v1/prompts", req);
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
};
