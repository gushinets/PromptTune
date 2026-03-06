import { API_BASE_URL } from "./constants";
import type { ImproveRequest, ImproveResponse, SavePromptRequest, SavePromptResponse } from "./types";

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

export const apiClient = {
  improve(req: ImproveRequest): Promise<ImproveResponse> {
    return post("/v1/improve", req);
  },

  savePrompt(req: SavePromptRequest): Promise<SavePromptResponse> {
    return post("/v1/prompts", req);
  },
};
