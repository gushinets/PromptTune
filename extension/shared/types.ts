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

export interface OptimizerRequestContext {
  mode: AudienceMode;
  goal: ImproveGoal;
}

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
  /** Extension receipt time of the successful generation, in milliseconds. */
  completed_at?: number;
  request_id: string;
  improved_text: string;
  changes?: string[];
  model?: string;
  latency_ms?: number;
  rate_limit?: RateLimitInfo;
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

export interface PromptInputLimit {
  max_chars: number;
  // True when the latest lookup failed or returned invalid configuration.
  fallback: boolean;
}

export interface RateLimitInfo {
  pending_improvements?: number;
  exhausted?: boolean | null;
  email_bonus_outcome?: "awarded" | "already_claimed" | null;
  remaining?: number;
  total?: number;
  next_reset_at?: string | null;
  bonus_claimed?: boolean;
  email_verified?: boolean;
  email?: string | null;
  verification_pending?: boolean;
  verification_resend_at?: string | null;
  // Deprecated aliases during server/extension rollout; these mirror monthly quota.
  per_minute_remaining: number;
  per_day_remaining: number;
  per_minute_total: number;
  per_day_total: number;
}
