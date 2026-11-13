import type { AudienceMode, ImproveGoal, ImproveResponse } from "./types";
import type { AnalyticsTrackPayload, AnalyticsTrackContext } from "./analytics-types";

export const IMPROVE_OWNER_PORT = "prompttune-improve-owner";

export type Message =
  | import("./panel-handoff").OpenOptimizerPanel
  | {
      type: "IMPROVE_REQUEST";
      payload: {
        text: string;
        client_request_id?: string;
        owner_required?: boolean;
        audience_mode?: AudienceMode;
        goal?: ImproveGoal;
        site?: string;
        page_url?: string;
        analytics_context?: AnalyticsTrackContext & {
          view_mode?: "popup" | "sidepanel";
          attempt_n?: number;
        };
      };
    }
  | { type: "CANCEL_IMPROVE"; payload: { client_request_id: string } }
  | { type: "IMPROVE_RESULT"; payload: ImproveResponse }
  | { type: "GET_PROMPT_LIMIT" }
  | { type: "GET_LIMITS" }
  | {
      type: "LIMITS_RESULT";
      payload: {
        rate_limit?: {
          per_minute_remaining: number;
          per_day_remaining: number;
          per_minute_total: number;
          per_day_total: number;
        };
      };
    }
  | { type: "PASTE_TEXT"; payload: { text: string } }
  | { type: "OPEN_AND_PASTE"; payload: { url: string; text: string } }
  | { type: "IMPROVE_ACTIVE_FIELD" }
  | { type: "TRACK_EVENT"; payload: AnalyticsTrackPayload }
  | { type: "TRACK_EVENTS"; payload: { events: AnalyticsTrackPayload[] } }
  | { type: "FLUSH_ANALYTICS" };
