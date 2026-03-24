import type { ImproveResponse } from "./types";

type RateLimitInfo = NonNullable<ImproveResponse["rate_limit"]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isImproveResponse(value: unknown): value is ImproveResponse {
  return (
    isRecord(value) &&
    typeof value.request_id === "string" &&
    typeof value.improved_text === "string"
  );
}

function isRateLimitInfo(value: unknown): value is RateLimitInfo {
  return (
    isRecord(value) &&
    typeof value.per_minute_remaining === "number" &&
    typeof value.per_day_remaining === "number" &&
    typeof value.per_minute_total === "number" &&
    typeof value.per_day_total === "number"
  );
}

export function extractImproveResponse(value: unknown): ImproveResponse | null {
  if (isImproveResponse(value)) {
    return value;
  }

  if (isRecord(value) && "payload" in value && isImproveResponse(value.payload)) {
    return value.payload;
  }

  return null;
}

export function extractRateLimitResponse(value: unknown): RateLimitInfo | null {
  if (isRateLimitInfo(value)) {
    return value;
  }

  if (isRecord(value) && "rate_limit" in value && isRateLimitInfo(value.rate_limit)) {
    return value.rate_limit;
  }

  if (isRecord(value) && "payload" in value && isRecord(value.payload)) {
    const payload = value.payload;
    if ("rate_limit" in payload && isRateLimitInfo(payload.rate_limit)) {
      return payload.rate_limit;
    }
  }

  return null;
}

export function describeUnexpectedBackgroundResponse(value: unknown): string {
  if (value === undefined) {
    return "Unexpected response from background: no response.";
  }

  if (value === null) {
    return "Unexpected response from background: null response.";
  }

  if (!isRecord(value)) {
    return `Unexpected response from background: ${String(value)}`;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) {
    return "Unexpected response from background: empty object.";
  }

  return `Unexpected response from background: keys=${keys.join(", ")}`;
}
