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
      audience_mode: "ai",
      goal: "structured",
      installation_id: "inst-1",
      client: "extension",
    });

    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.anytoolai.store/v1/improve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          text: "original",
          audience_mode: "ai",
          goal: "structured",
          installation_id: "inst-1",
          client: "extension",
        }),
      }),
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

  it("events sends analytics batch to backend", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ accepted: 1, deduplicated: 0 }),
    });

    const result = await apiClient.events([
      {
        event_id: "evt-1",
        name: "popup_opened",
        user_id: "inst-1",
        session_id: "sess-1",
        occurred_at: new Date("2026-05-15T10:00:00.000Z").toISOString(),
        extension_version: "0.1.0",
        os: "mac",
        chrome_version: "136",
        user_plan: "free",
        source: "popup",
        properties: { view_mode: "popup" },
      },
    ]);

    expect(result).toEqual({ accepted: 1, deduplicated: 0 });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.anytoolai.store/v1/events",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});

describe("input length protection", () => {
  it("rejects oversized text before posting an improve request", async () => {
    global.fetch = vi.fn();
    await expect(
      apiClient.improve({ text: "x".repeat(30001), installation_id: "i", client: "extension" }),
    ).rejects.toThrow("maximum length of 30000");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/v1/improve"))).toBe(
      false,
    );
  });
});

describe("server prompt limits", () => {
  it("retains the last valid limit when configuration is invalid or unavailable", async () => {
    vi.resetModules();
    const { apiClient: client } = await import("@shared/api-client");
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ prompt_input_max_chars: 12 }) });
    expect(await client.promptInputLimit(true)).toBe(12);
    await expect(
      client.improve({ text: "x".repeat(13), installation_id: "i", client: "extension" }),
    ).rejects.toThrow("maximum length of 12");
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const limit of [0, -1, 1.5, "20", null]) {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ prompt_input_max_chars: limit }),
      } as Response);
      expect(await client.promptInputLimit(true)).toBe(12);
    }
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    expect(await client.promptInputLimit(true)).toBe(12);
  });
});

it("loads the configured limit before a fresh direct improve call", async () => {
  vi.resetModules();
  const { apiClient: client } = await import("@shared/api-client");
  global.fetch = vi.fn().mockImplementation(async (url) => {
    if (String(url).endsWith("/v1/config"))
      return { ok: true, json: async () => ({ prompt_input_max_chars: 8000 }) };
    return { ok: true, json: async () => ({ request_id: "r", improved_text: "better" }) };
  });
  await expect(
    client.improve({ text: "x".repeat(8001), installation_id: "i", client: "extension" }),
  ).rejects.toThrow("maximum length of 8000");
  expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
    "https://api.anytoolai.store/v1/config",
  ]);
});

it("allows a fresh direct request when the configured limit exceeds the fallback", async () => {
  vi.resetModules();
  const { apiClient: client } = await import("@shared/api-client");
  global.fetch = vi.fn().mockImplementation(async (url) => ({
    ok: true,
    json: async () =>
      String(url).endsWith("/v1/config")
        ? { prompt_input_max_chars: 40000 }
        : { request_id: "r", improved_text: "better" },
  }));
  await expect(
    client.improve({ text: "x".repeat(30001), installation_id: "i", client: "extension" }),
  ).resolves.toEqual({ request_id: "r", improved_text: "better" });
});

it.each([false, true])(
  "times out a stalled config lookup and keeps improvement available (cached=%s)",
  async (cached) => {
    vi.resetModules();
    vi.useFakeTimers();
    try {
      const { apiClient: client } = await import("@shared/api-client");
      if (cached) {
        global.fetch = vi
          .fn()
          .mockResolvedValue({ ok: true, json: async () => ({ prompt_input_max_chars: 12 }) });
        expect(await client.promptInputLimit()).toBe(12);
        expect(vi.getTimerCount()).toBe(0);
      }
      let configSignal: AbortSignal | undefined;
      global.fetch = vi.fn().mockImplementation((url, options?: RequestInit) => {
        if (String(url).endsWith("/v1/config")) {
          configSignal = options?.signal ?? undefined;
          return new Promise((_resolve, reject) => {
            configSignal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ request_id: "r", improved_text: "better" }),
        });
      });
      let resolvedLimit: number | undefined;
      const lookup = client.promptInputLimit(true).then((limit) => {
        resolvedLimit = limit;
      });
      await vi.advanceTimersByTimeAsync(2999);
      expect(resolvedLimit).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(resolvedLimit).toBe(cached ? 12 : 30000);
      await lookup;
      expect(configSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      await expect(
        client.improve({ text: "short", installation_id: "i", client: "extension" }),
      ).resolves.toEqual({ request_id: "r", improved_text: "better" });
      expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
        "https://api.anytoolai.store/v1/config",
        "https://api.anytoolai.store/v1/improve",
      ]);
    } finally {
      vi.useRealTimers();
    }
  },
);
