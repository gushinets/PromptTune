import type { ImproveGoal } from "./types";

export type Message =
  | {
      type: "IMPROVE_REQUEST";
      payload: { text: string; goal?: ImproveGoal; site?: string; page_url?: string };
    }
  | { type: "IMPROVE_RESULT"; payload: { improved_text: string; request_id: string } }
import type { ImproveResponse } from "./types";

export type Message =
  | { type: "IMPROVE_REQUEST"; payload: { text: string; site?: string; page_url?: string } }
  | { type: "IMPROVE_RESULT"; payload: ImproveResponse }
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
  | { type: "IMPROVE_ACTIVE_FIELD" };
