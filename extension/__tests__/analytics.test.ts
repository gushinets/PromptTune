import { describe, it, expect, vi, beforeEach } from "vitest";
import browser from "webextension-polyfill";
import { trackEvent } from "@shared/analytics";

describe("analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("trackEvent sends TRACK_EVENT message with source and properties", async () => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ ok: true });

    await trackEvent("popup_opened", { view_mode: "popup", hour: 12 }, "popup");

    expect(vi.mocked(browser.runtime.sendMessage)).toHaveBeenCalledWith({
      type: "TRACK_EVENT",
      payload: {
        name: "popup_opened",
        properties: { view_mode: "popup", hour: 12 },
        context: { source: "popup" },
      },
    });
  });

  it("trackEvent sends TRACK_EVENT without context when source omitted", async () => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ ok: true });

    await trackEvent("api_error", { endpoint: "/v1/improve" });

    expect(vi.mocked(browser.runtime.sendMessage)).toHaveBeenCalledWith({
      type: "TRACK_EVENT",
      payload: {
        name: "api_error",
        properties: { endpoint: "/v1/improve" },
        context: undefined,
      },
    });
  });
});
