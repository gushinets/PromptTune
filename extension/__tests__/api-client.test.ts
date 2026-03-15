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
});
