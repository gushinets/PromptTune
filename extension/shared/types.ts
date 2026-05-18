export type AudienceMode = "ai" | "content";

export type AiImproveGoal =
  | "general"
  | "chatgpt"
  | "claude"
  | "perplexity"
  | "structured"
  | "deep_research";

export type ContentImproveGoal =
  | "general"
  | "seo_article"
  | "product_description"
  | "ad_copy"
  | "email"
  | "landing_page";

export type ImproveGoal = AiImproveGoal | ContentImproveGoal;

export interface ImproveRequest {
  text: string;
  audience_mode?: AudienceMode;
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
  changes?: string[];
  model?: string;
  latency_ms?: number;
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
