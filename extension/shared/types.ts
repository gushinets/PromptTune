export interface ImproveRequest {
  text: string;
  installation_id: string;
  site?: string;
  page_url?: string;
}

export interface ImproveResponse {
  request_id: string;
  improved_text: string;
  rate_limit?: {
    per_minute_remaining: number;
    per_day_remaining: number;
  };
}

export interface SavePromptRequest {
  installation_id: string;
  original_text: string;
  improved_text: string;
  site?: string;
  page_url?: string;
  meta?: Record<string, unknown>;
}

export interface SavePromptResponse {
  prompt_id: string;
}
