import type { AudienceMode, ImproveGoal, ImproveResponse, RateLimitInfo } from "./types";
import type { AnalyticsTrackPayload, AnalyticsTrackContext } from "./analytics-types";

export const IMPROVE_OWNER_PORT = "prompttune-improve-owner";

export type Message =
  | { type: "GET_PENDING_PANEL_HANDOFFS"; windowId: number }
  | { type: "CONFIRM_PANEL_HANDOFF"; windowId: number; id: string }
  | {
      type: "CLOSE_PANEL_FOR_ROLLBACK";
      windowId: number;
      requestId?: string;
      failedHandoffId?: string;
    }
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
      type: "SHOW_QUOTA";
      payload: { original: string; result?: ImproveResponse; goal?: ImproveGoal };
    }
  | { type: "REQUEST_EMAIL_BONUS"; email: string }
  | { type: "CONFIRM_EMAIL_BONUS"; code: string }
  | {
      type: "LIMITS_RESULT";
      payload: {
        rate_limit?: RateLimitInfo;
      };
    }
  | { type: "PASTE_TEXT"; payload: { text: string } }
  | { type: "OPEN_AND_PASTE"; payload: { url: string; text: string } }
  | { type: "IMPROVE_ACTIVE_FIELD" }
  | { type: "TRACK_EVENT"; payload: AnalyticsTrackPayload }
  | { type: "TRACK_EVENTS"; payload: { events: AnalyticsTrackPayload[] } }
  | { type: "FLUSH_ANALYTICS" };
