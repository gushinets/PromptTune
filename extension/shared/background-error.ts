import { ApiError } from "./api-client";

export type BackgroundErrorResponse = {
  type: "IMPROVE_ERROR" | "LIMITS_ERROR";
  error:
    | { kind: "api"; status: number; detail: string }
    | { kind: "aborted" }
    | { kind: "error"; name: string; message: string };
};

/** Return plain data: runtime messaging does not preserve custom Error fields. */
export function serializeBackgroundError(
  error: unknown,
  type: BackgroundErrorResponse["type"] = "IMPROVE_ERROR",
): BackgroundErrorResponse {
  if (error instanceof ApiError) {
    return {
      type,
      error: { kind: "api", status: error.status, detail: error.detail },
    };
  }
  if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
    return { type, error: { kind: "aborted" } };
  }
  return {
    type,
    error: {
      kind: "error",
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

export function throwIfBackgroundFailed(response: unknown): void {
  if (
    !response ||
    typeof response !== "object" ||
    !("type" in response) ||
    (response.type !== "IMPROVE_ERROR" && response.type !== "LIMITS_ERROR")
  )
    return;
  const { error } = response as BackgroundErrorResponse;
  if (error.kind === "api") throw new ApiError(error.status, error.detail);
  if (error.kind === "aborted") throw new DOMException("Aborted", "AbortError");
  const restored = new Error(error.message);
  restored.name = error.name;
  throw restored;
}
