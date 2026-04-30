import type { ImproveResponse } from "./types";

type RateLimitInfo = NonNullable<ImproveResponse["rate_limit"]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeChanges(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const normalized = value
    .filter((line): line is string => typeof line === "string")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 5);

  return normalized.length > 0 ? normalized : undefined;
}

function toImproveResponse(value: Record<string, unknown>): ImproveResponse | null {
  if (typeof value.request_id !== "string" || typeof value.improved_text !== "string") {
    return null;
  }

  const response: ImproveResponse = {
    request_id: value.request_id,
    improved_text: value.improved_text,
  };

  if ("rate_limit" in value && isRateLimitInfo(value.rate_limit)) {
    response.rate_limit = value.rate_limit;
  }

  const changes = normalizeChanges(value.changes);
  if (changes) {
    response.changes = changes;
  }

  return response;
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
  if (isRecord(value)) {
    const direct = toImproveResponse(value);
    if (direct) {
      return direct;
    }
  }

  if (isRecord(value) && "payload" in value && isRecord(value.payload)) {
    return toImproveResponse(value.payload);
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
