export const ANALYTICS_EVENT_NAMES = [
  "extension_installed",
  "onboarding_completed",
  "onboarding_abandoned",
  "first_prompt_submitted",
  "first_result_copied",
  "popup_opened",
  "prompt_submitted",
  "result_displayed",
  "result_copied",
  "result_regenerated",
  "api_error",
  "extension_disabled",
  "uninstall_reason_submitted",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export type AnalyticsSource = "background" | "popup" | "sidepanel" | "content" | "forms_import";

export interface AnalyticsTrackContext {
  source?: AnalyticsSource;
}

export type AnalyticsProperties = Record<string, unknown>;

export interface AnalyticsTrackPayload {
  name: AnalyticsEventName;
  properties?: AnalyticsProperties;
  context?: AnalyticsTrackContext;
}

export interface AnalyticsSessionState {
  session_id: string;
  session_started_at: string;
  last_activity_at: string;
  session_prompt_n: number;
}

export interface AnalyticsEventOut {
  event_id: string;
  name: AnalyticsEventName;
  user_id: string;
  session_id: string | null;
  occurred_at: string;
  extension_version?: string;
  os?: string;
  chrome_version?: string;
  user_plan?: string;
  source?: AnalyticsSource;
  properties: AnalyticsProperties;
}
