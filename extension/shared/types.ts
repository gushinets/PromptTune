export type ImproveGoal = "general" | "clarity" | "structure" | "concise" | "persuasive";

export interface ImproveRequest {
  text: string;
  goal?: ImproveGoal;
  installation_id: string;
  client: string;
  client_version?: string;
  site?: string;
  page_url?: string;
  client_ts?: number;
}

export interface ImproveResponse {
  request_id: string;
  improved_text: string;
  rate_limit?: {
    per_minute_remaining: number;
    per_day_remaining: number;
    per_minute_total: number;
    per_day_total: number;
  };
}

export interface SavePromptRequest {
  installation_id: string;
  client: string;
  client_version?: string;
  original_text: string;
  improved_text: string;
  site?: string;
  page_url?: string;
  meta?: Record<string, unknown>;
}

export interface SavePromptResponse {
  prompt_id: string;
}
