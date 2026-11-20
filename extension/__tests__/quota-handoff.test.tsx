import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { App } from "../entrypoints/popup/App";
import { openQuotaWindow } from "../shared/quota-window";
import { loadSelectionSession } from "../shared/selection";
import { setPopupSessionDraft } from "../shared/storage";
import { SidepanelApp } from "../entrypoints/sidepanel/SidepanelApp";
import {
  openOptimizerPanel,
  confirmPanelHandoff,
  type OpenOptimizerPanel,
} from "../shared/panel-handoff";

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
  vi.spyOn(window, "close").mockImplementation(() => {});
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
  window.history.replaceState({}, "", "/");
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
    window.history.replaceState({}, "", `/popup.html${search}`);
    const session = await loadSelectionSession(window.location.search);
    expect(session).toMatchObject({ initialQuota: quota, quotaOnly: true });
    expect(await loadSelectionSession(search)).toMatchObject({ quotaOnly: true });
    expect((await loadSelectionSession(search)).initialQuota).toBeUndefined();
    await act(async () => root.render(<App {...session} />));
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
      "Get 50 more improvements?",
    );
    expect(host.textContent).not.toContain("Private original");
    expect(host.textContent).not.toContain("Private result");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-close]")!.click());
    expect(host.querySelector(".error-toast")).toBeNull();
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
  const search = new URL(String(options.url), "https://extension.test").search;
  window.history.replaceState({}, "", `/popup.html${search}`);
  const session = await loadSelectionSession(window.location.search);
  expect(session).toMatchObject({ initialQuota: claimed, quotaOnly: true });
  await act(async () => root.render(<App {...session} />));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector(".upgrade-banner")?.textContent).toContain("2027");
  expect(host.querySelector(".error-toast")).toBeNull();
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

it("keeps private quota windows out of regular drafts and returns to their source tab", async () => {
  await setPopupSessionDraft({
    draftSessionId: "regular",
    draftCreatedAt: Date.now(),
    activeTab: "improve",
    original: "Regular prompt",
    improved: "Unrelated regular result",
    changes: [],
    goal: "general",
    lastRequestId: "regular",
    lastRequestContextKey: null,
    lastModel: null,
    lastLatencyMs: null,
    attemptN: 1,
  });
  const before = JSON.stringify(state);
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  Object.assign(browser.tabs, { update: vi.fn().mockResolvedValue({}) });
  Object.assign(browser.windows, { update: vi.fn().mockResolvedValue({}) });
  vi.mocked(browser.tabs.get).mockResolvedValue({ id: 42, windowId: 9, incognito: true } as never);
  vi.mocked(browser.runtime.sendMessage).mockRejectedValue(new Error("offline"));
  await openQuotaWindow(
    "Private original",
    { request_id: "private", improved_text: "Private result", rate_limit: quota },
    { id: 42, incognito: true } as never,
  );
  const options = vi.mocked(browser.windows.create).mock.calls.at(-1)![0]!;
  const session = await loadSelectionSession(
    new URL(String(options.url), "https://extension.test").search,
  );
  await act(async () => root.render(<App {...session} />));
  expect(host.querySelector(".improved-textarea")).toBeNull();
  expect(host.querySelector("textarea")).toBeNull();
  expect(JSON.stringify(state)).toBe(before);
  await act(async () => host.querySelector<HTMLButtonElement>("[data-close]")!.click());
  expect(browser.tabs.update).toHaveBeenCalledWith(42, { active: true });
  expect(browser.windows.update).toHaveBeenCalledWith(9, { focused: true });
  expect(close).toHaveBeenCalledOnce();
});

it.each([
  { scenario: "monthly renewal", remaining: 50, bonus_claimed: false },
  { scenario: "bonus claimed elsewhere", remaining: 0, bonus_claimed: true },
])("closes a private bonus offer after $scenario", async (fresh) => {
  let release!: (value: unknown) => void;
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
    if ((message as { type?: string }).type === "GET_LIMITS")
      return new Promise((resolve) => {
        release = resolve;
      });
    return { ok: true };
  });
  await act(async () => root.render(<App quotaOnly initialQuota={quota} />));
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () =>
    release({
      ...quota,
      remaining: fresh.remaining,
      per_day_remaining: fresh.remaining,
      bonus_claimed: fresh.bonus_claimed,
    }),
  );
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector(".btn-upgrade")).toBeNull();
});

it("shows the Moscow renewal day when the browser's default timezone is New York", async () => {
  const formatDate = Date.prototype.toLocaleDateString;
  vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (
    this: Date,
    locales,
    options,
  ) {
    return formatDate.call(this, locales ?? "en-US", { timeZone: "America/New_York", ...options });
  });
  vi.mocked(browser.runtime.sendMessage).mockRejectedValue(new Error("offline"));
  await act(async () =>
    root.render(<App quotaOnly initialQuota={{ ...quota, bonus_claimed: true }} />),
  );
  expect(host.querySelector(".upgrade-banner")?.textContent).toContain("1/6/2027");
});

it.each(
  [
    { binding: "unbound toolbar", previous: {}, target: 42 },
    {
      binding: "standalone target",
      previous: { standaloneTarget: { tabId: 99, sessionId: "test-session" } },
      target: 99,
    },
    {
      binding: "source tab",
      previous: { sourceTabId: 99, sourceSessionId: "test-session" },
      target: 99,
    },
  ].flatMap((entry) => [false, true].map((viaPanel) => ({ ...entry, viaPanel }))),
)(
  "inserts a restored result with $binding into the correct tab (viaPanel=$viaPanel)",
  async ({ previous, target, viaPanel }) => {
    await setPopupSessionDraft({
      draftSessionId: "toolbar",
      draftCreatedAt: Date.now(),
      audienceMode: "ai",
      optimizer_screen: "result",
      activeTab: "improve",
      original: "Toolbar prompt",
      improved: "Toolbar result",
      changes: [],
      goal: "general",
      result_context: { mode: "ai", goal: "general" },
      lastRequestId: "toolbar",
      lastRequestContextKey: "ai|general|Toolbar prompt",
      lastModel: null,
      lastLatencyMs: null,
      attemptN: 1,
      ...previous,
    });
    const sessionState: Record<string, unknown> = { optimizer_browser_session: "test-session" };
    vi.mocked(browser.storage.session.get).mockImplementation(async () => ({ ...sessionState }));
    vi.mocked(browser.storage.session.set).mockImplementation(async (values) => {
      Object.assign(sessionState, values);
    });
    vi.mocked(browser.storage.session.remove).mockImplementation(async (keys) => {
      for (const key of [keys].flat()) delete sessionState[key];
    });
    Object.assign(browser, { sidePanel: { open: vi.fn().mockResolvedValue(undefined) } });
    vi.mocked(browser.windows.getCurrent).mockResolvedValue({ id: 7 } as never);
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (raw) => {
      const msg = raw as { type?: string; windowId: number; id: string };
      if (msg.type === "GET_LIMITS") return quota;
      if (msg.type === "OPEN_OPTIMIZER_PANEL") return openOptimizerPanel(raw as OpenOptimizerPanel);
      if (msg.type === "CONFIRM_PANEL_HANDOFF") return confirmPanelHandoff(msg.windowId, msg.id);
      return { ok: true };
    });
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ success: true });
    vi.mocked(browser.tabs.get).mockImplementation(
      async (id) => ({ id, windowId: 7, url: "https://chatgpt.com" }) as never,
    );
    vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 7, url: "popup.html" }] as never);
    for (const tabId of [11, 42]) {
      await openQuotaWindow("Rejected hotkey", undefined, { id: tabId } as never);
      const options = vi.mocked(browser.windows.create).mock.calls.at(-1)![0]!;
      const search = new URL(String(options.url), "https://extension.test").search;
      window.history.replaceState({}, "", `/popup.html${search}`);
      const session = await loadSelectionSession(search);
      await act(async () => root.render(<App {...session} />));
      await act(async () => host.querySelector<HTMLButtonElement>("[data-close]")!.click());
      if (tabId === 11) {
        if (viaPanel) {
          await act(async () =>
            host.querySelector<HTMLButtonElement>(".layout-toggle-btn")!.click(),
          );
          expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "OPEN_OPTIMIZER_PANEL" }),
          );
          await act(async () => root.unmount());
          root = createRoot(host);
          window.history.replaceState({}, "", "/sidepanel.html");
          vi.mocked(browser.tabs.get).mockClear();
          await act(async () => root.render(<SidepanelApp />));
          expect(host.querySelector(".result-screen")?.textContent).toContain("Toolbar result");
          expect(browser.tabs.get).toHaveBeenCalledWith(target === 42 ? 11 : target);
        }
        // The first window is closed without inserting; its autosave must not bind the result.
        await act(async () => root.unmount());
        root = createRoot(host);
      }
    }
    const insert = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Insert",
    )!;
    await act(async () => insert.click());
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(target, {
      type: "PASTE_TEXT",
      payload: { text: "Toolbar result" },
    });
  },
);
