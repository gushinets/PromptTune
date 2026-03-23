import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiClient, ApiError } from "@shared/api-client";

describe("apiClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("improve sends POST to the production FastAPI backend by default", async () => {
    const mockResponse = { request_id: "r1", improved_text: "better prompt" };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await apiClient.improve({
      text: "original",
      installation_id: "inst-1",
      client: "extension",
    });

    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.anytoolai.store/v1/improve",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("limits uses the production FastAPI backend by default", async () => {
    const mockResponse = {
      per_minute_remaining: 9,
      per_day_remaining: 49,
      per_minute_total: 10,
      per_day_total: 50,
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await apiClient.limits("inst-1");

    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.anytoolai.store/v1/limits?installation_id=inst-1",
      { method: "GET" },
    );
  });

  it("throws on non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: () => Promise.resolve("Rate limited"),
    });

    await expect(
      apiClient.improve({ text: "test", installation_id: "inst-1", client: "extension" }),
    ).rejects.toThrow("API 429");
  });

  it("throws with 403 and login-invalid detail so popup can show auth toast", async () => {
    const detail = JSON.stringify({ detail: "Your login is invalid" });
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: () => Promise.resolve(detail),
    });

    const err = await apiClient
      .improve({ text: "test", installation_id: "inst-1", client: "extension" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/403/);
    expect((err as Error).message).toMatch(/login is invalid/i);
  });

  it("extracts JSON detail for 422 errors", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      text: () => Promise.resolve(JSON.stringify({ detail: "Input text exceeds maximum length." })),
    });

    const err = await apiClient
      .improve({ text: "test", installation_id: "inst-1", client: "extension" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).detail).toBe("Input text exceeds maximum length.");
  });
});
