import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { App } from "../entrypoints/popup/App";
import { openQuotaWindow } from "../shared/quota-window";
import { loadSelectionSession } from "../shared/selection";

let state: Record<string, unknown>, host: HTMLDivElement, root: Root;
const quota = {
  remaining: 0,
  total: 50,
  pending_improvements: 0,
  exhausted: true,
  bonus_claimed: false,
  email_verified: false,
  next_reset_at: "2027-01-05T21:00:00Z",
  per_day_remaining: 0,
  per_day_total: 50,
  per_minute_remaining: 9,
  per_minute_total: 10,
};
beforeEach(() => {
  vi.clearAllMocks();
  state = { installation_id: "i", audience_mode: "ai", library: [] };
  vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ ...state }));
  vi.mocked(browser.storage.local.set).mockImplementation(async (values) => {
    Object.assign(state, values);
  });
  vi.mocked(browser.storage.local.remove).mockImplementation(async (keys) => {
    for (const key of [keys].flat()) delete state[key];
  });
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    optimizer_browser_session: "test-session",
  });
  vi.mocked(browser.runtime.getManifest).mockReturnValue({ version: "0.1.0" } as never);
  vi.mocked(browser.runtime.getURL).mockImplementation((path) => path);
  vi.mocked(browser.windows.create).mockResolvedValue({ id: 7 } as never);
  vi.mocked(browser.tabs.query).mockResolvedValue([]);
  vi.mocked(browser.tabs.get).mockResolvedValue({ id: 42, url: "https://chatgpt.com" } as never);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
it.each(["slow", "failed"])(
  "shows the hotkey's offer immediately from the successful response while quota refresh is %s",
  async (mode) => {
    let release!: (value: unknown) => void;
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
      if ((message as { type?: string }).type === "GET_LIMITS") {
        if (mode === "failed") throw new Error("Failed to fetch");
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return { ok: true };
    });
    await openQuotaWindow(
      "Original",
      { request_id: "last", improved_text: "Final hotkey result", rate_limit: quota },
      { id: 42 } as never,
    );
    const options = vi.mocked(browser.windows.create).mock.calls.at(-1)![0]!;
    const session = await loadSelectionSession(
      new URL(String(options.url), "https://extension.test").search,
    );
    expect(session).toMatchObject({ initialQuota: quota });
    await act(async () => root.render(<App {...session} />));
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
      "Get 50 more improvements?",
    );
    expect((host.querySelector(".improved-textarea") as HTMLTextAreaElement)?.value).toBe(
      "Final hotkey result",
    );
    if (mode === "slow") {
      await act(async () => host.querySelector<HTMLButtonElement>("[data-close]")!.click());
      await act(async () => release(quota));
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      expect(
        [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Copy"))
          ?.disabled,
      ).toBe(false);
    }
  },
);

it.each(["expired", "other-session"])("does not seed a quota snapshot that is %s", async (mode) => {
  vi.useFakeTimers();
  try {
    await openQuotaWindow(
      "Original",
      { request_id: "last", improved_text: "Final result", rate_limit: quota },
      { id: 42 } as never,
    );
    const options = vi.mocked(browser.windows.create).mock.calls.at(-1)![0]!;
    if (mode === "expired") vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    else
      vi.mocked(browser.storage.session.get).mockResolvedValue({
        optimizer_browser_session: "other-session",
      });
    const session = await loadSelectionSession(
      new URL(String(options.url), "https://extension.test").search,
    );
    expect(session.initialQuota).toBeUndefined();
    expect(session.initialDraft?.improved).toBe("Final result");
  } finally {
    vi.useRealTimers();
  }
});
