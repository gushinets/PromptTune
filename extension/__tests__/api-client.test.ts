import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiClient } from "@shared/api-client";

describe("apiClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("improve sends POST and returns response", async () => {
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
      expect.stringContaining("/v1/improve"),
      expect.objectContaining({ method: "POST" }),
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
});
