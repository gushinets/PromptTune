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

it.each([
  { mode: "expired", incognito: false },
  { mode: "other-session", incognito: false },
  { mode: "expired", incognito: true },
  { mode: "other-session", incognito: true },
])(
  "does not seed a quota snapshot that is $mode (private=$incognito)",
  async ({ mode, incognito }) => {
    vi.useFakeTimers();
    try {
      await openQuotaWindow(
        "Original",
        { request_id: "last", improved_text: "Final result", rate_limit: quota },
        { id: 42, incognito } as never,
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
      expect(session.initialDraft?.improved).toBe(incognito ? undefined : "Final result");
    } finally {
      vi.useRealTimers();
    }
  },
);

it.each(["slow", "failed"])(
  "seeds private quota without page text when refresh is %s",
  async (mode) => {
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
      if ((message as { type?: string }).type === "GET_LIMITS") {
        if (mode === "failed") throw new Error("Failed to fetch");
        return new Promise(() => {});
      }
      return { ok: true };
    });
    await openQuotaWindow(
      "Private original",
      {
        request_id: "private-request",
        improved_text: "Private result",
        rate_limit: { ...quota, email: "excluded@example.com" },
      },
      { id: 42, incognito: true } as never,
    );
    const writes = JSON.stringify(vi.mocked(browser.storage.local.set).mock.calls);
    expect(writes).not.toContain("Private original");
    expect(writes).not.toContain("Private result");
    expect(writes).not.toContain("private-request");
    expect(writes).not.toContain("excluded@example.com");
    expect(writes).not.toContain("sourceTabId");
    expect(Object.keys(state).some((key) => key.startsWith("optimizer_draft_"))).toBe(false);
    const options = vi.mocked(browser.windows.create).mock.calls.at(-1)![0]!;
    const search = new URL(String(options.url), "https://extension.test").search;
    const session = await loadSelectionSession(search);
    expect(session).toEqual({ initialQuota: quota });
    expect(await loadSelectionSession(search)).toEqual({});
    await act(async () => root.render(<App {...session} />));
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
      "Get 50 more improvements?",
    );
    expect(host.textContent).not.toContain("Private original");
    expect(host.textContent).not.toContain("Private result");
  },
);

it("shows the private renewal date after the bonus when refresh fails", async () => {
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
    if ((message as { type?: string }).type === "GET_LIMITS") throw new Error("offline");
    return { ok: true };
  });
  const claimed = { ...quota, bonus_claimed: true, email_verified: true };
  await openQuotaWindow(
    "Private original",
    {
      request_id: "private-request",
      improved_text: "Private result",
      rate_limit: claimed,
    },
    { id: 42, incognito: true } as never,
  );
  const options = vi.mocked(browser.windows.create).mock.calls.at(-1)![0]!;
  const session = await loadSelectionSession(
    new URL(String(options.url), "https://extension.test").search,
  );
  expect(session).toEqual({ initialQuota: claimed });
  await act(async () => root.render(<App {...session} />));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector(".upgrade-banner")?.textContent).toContain("2027");
});

it("removes the private quota handoff when its window cannot open", async () => {
  vi.mocked(browser.windows.create).mockRejectedValueOnce(new Error("window unavailable"));
  await expect(
    openQuotaWindow(
      "Private original",
      {
        request_id: "private-request",
        improved_text: "Private result",
        rate_limit: quota,
      },
      { id: 42, incognito: true } as never,
    ),
  ).rejects.toThrow("window unavailable");
  expect(Object.keys(state).some((key) => key.startsWith("optimizer_selection_"))).toBe(false);
});
