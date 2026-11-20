import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { App } from "../entrypoints/popup/App";
import { SidepanelApp } from "../entrypoints/sidepanel/SidepanelApp";
import {
  openOptimizerPanel,
  confirmPanelHandoff,
  type OpenOptimizerPanel,
} from "../shared/panel-handoff";
import type { PopupSessionDraft } from "../shared/storage";
import type { RateLimitInfo } from "../shared/types";
import { openQuotaWindow } from "../shared/quota-window";
import { loadSelectionSession } from "../shared/selection";

let host: HTMLDivElement, root: Root, activeTab: number;
let local: Record<string, unknown>, session: Record<string, unknown>;
const limits = {
  remaining: 50,
  total: 50,
  per_day_remaining: 50,
  per_day_total: 50,
  per_minute_remaining: 10,
  per_minute_total: 10,
};
type SurfaceTarget = { tabId: number; sessionId: string };
const bindingCases: Array<{
  binding: string;
  fields: Partial<PopupSessionDraft>;
  borrowed?: SurfaceTarget;
}> = [
  { binding: "source", fields: { sourceTabId: 11, sourceSessionId: "test-session" } },
  { binding: "standalone", fields: { standaloneTarget: { tabId: 11, sessionId: "test-session" } } },
  {
    binding: "borrowed quota target",
    fields: {},
    borrowed: { tabId: 11, sessionId: "test-session" },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  activeTab = 11;
  local = { installation_id: "installed", audience_mode: "ai", library: [] };
  session = { optimizer_browser_session: "test-session" };
  vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ ...local }));
  vi.mocked(browser.storage.local.set).mockImplementation(async (values) => {
    Object.assign(local, values);
  });
  vi.mocked(browser.storage.local.remove).mockImplementation(async (keys) => {
    for (const key of [keys].flat()) delete local[key];
  });
  vi.mocked(browser.storage.session.get).mockImplementation(async () => ({ ...session }));
  vi.mocked(browser.storage.session.set).mockImplementation(async (values) => {
    Object.assign(session, values);
  });
  vi.mocked(browser.storage.session.remove).mockImplementation(async (keys) => {
    for (const key of [keys].flat()) delete session[key];
  });
  vi.mocked(browser.windows.getCurrent).mockResolvedValue({ id: 7 } as never);
  vi.mocked(browser.tabs.get).mockImplementation(
    async (id) => ({ id, windowId: 7, url: "https://chatgpt.com" }) as never,
  );
  vi.mocked(browser.tabs.query).mockImplementation(
    async () => [{ id: activeTab, windowId: 7, url: "https://chatgpt.com" }] as never,
  );
  vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ success: true });
  Object.assign(browser, { sidePanel: { open: vi.fn().mockResolvedValue(undefined) } });
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (raw) => {
    const msg = raw as { type?: string; windowId: number; id: string };
    if (msg.type === "GET_LIMITS") return limits;
    if (msg.type === "GET_PROMPT_LIMIT") return { max_chars: 30000, fallback: false };
    if (msg.type === "IMPROVE_REQUEST")
      return { request_id: "new-result", improved_text: "New result", rate_limit: limits };
    if (msg.type === "OPEN_OPTIMIZER_PANEL") return openOptimizerPanel(raw as OpenOptimizerPanel);
    if (msg.type === "CONFIRM_PANEL_HANDOFF") return confirmPanelHandoff(msg.windowId, msg.id);
    return { ok: true };
  });
  vi.spyOn(window, "close").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

async function click(label: string) {
  const button =
    label === "Improve"
      ? host.querySelector<HTMLButtonElement>(".btn-improve")!
      : [...host.querySelectorAll<HTMLButtonElement>("button")].find(
          (item) => item.textContent?.trim() === label,
        )!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}

async function mountPopup(fields: Partial<PopupSessionDraft>, borrowed?: SurfaceTarget) {
  const draft: PopupSessionDraft = {
    draftSessionId: "bound-result",
    draftCreatedAt: Date.now(),
    audienceMode: "ai",
    activeTab: "improve",
    optimizer_screen: "result",
    original: "Original prompt",
    improved: "Original result",
    changes: [],
    goal: "general",
    result_context: { mode: "ai", goal: "general" },
    lastRequestId: "original",
    lastRequestContextKey: "ai|general|Original prompt",
    lastModel: null,
    lastLatencyMs: null,
    attemptN: 1,
    ...fields,
  };
  window.history.replaceState(
    {},
    "",
    "/popup.html?selection=optimizer_selection_bound-result&session=bound-result",
  );
  await act(async () => root.render(<App initialDraft={draft} quotaReturnTarget={borrowed} />));
}

async function switchSurface(panel: boolean, expectedResult = "Original result") {
  const closes = vi.mocked(window.close).mock.calls.length;
  await act(async () => host.querySelector<HTMLButtonElement>(".layout-toggle-btn")!.click());
  expect(window.close).toHaveBeenCalledTimes(closes + 1);
  await act(async () => root.unmount());
  root = createRoot(host);
  window.history.replaceState({}, "", panel ? "/sidepanel.html" : "/popup.html");
  await act(async () => root.render(panel ? <SidepanelApp /> : <App />));
  expect(host.querySelector(".improved-textarea")?.textContent).toBe(expectedResult);
}

it.each(bindingCases.flatMap((entry) => [false, true].map((panel) => ({ ...entry, panel }))))(
  "New releases the target only in the panel (binding=$binding, panel=$panel)",
  async ({ fields, panel, borrowed }) => {
    await mountPopup(fields, borrowed);
    if (panel) await switchSurface(true);
    activeTab = 42;
    const onActivated = vi.mocked(browser.tabs.onActivated.addListener).mock.calls.at(-1)![0];
    await act(async () => onActivated({ tabId: 42, windowId: 7 }));
    await click("New");
    await act(async () => {
      const input = host.querySelector<HTMLTextAreaElement>(".original-textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        input,
        "Another prompt",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Improve");
    expect(host.querySelector(".improved-textarea")?.textContent).toBe("New result");
    await click("Insert");
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(panel ? 42 : 11, {
      type: "PASTE_TEXT",
      payload: { text: "New result" },
    });
  },
);

it.each(bindingCases)(
  "preserves binding semantics across panel and toolbar ($binding)",
  async ({ fields, borrowed }) => {
    await mountPopup(fields, borrowed);
    await switchSurface(true);
    activeTab = 42;
    await switchSurface(false);
    await click("Insert");
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(borrowed ? 42 : 11, {
      type: "PASTE_TEXT",
      payload: { text: "Original result" },
    });
  },
);

it("opens the panel for a generic toolbar restore using its active tab", async () => {
  await mountPopup({ standaloneTarget: { tabId: 11, sessionId: "test-session" } });
  await act(async () => root.unmount());
  root = createRoot(host);
  activeTab = 42;
  window.history.replaceState({}, "", "/popup.html");
  await act(async () => root.render(<App />));
  await switchSurface(true);
  await click("Insert");
  expect(browser.tabs.sendMessage).toHaveBeenCalledWith(42, {
    type: "PASTE_TEXT",
    payload: { text: "Original result" },
  });
});

it("binds a new result to the quota window after the email bonus across panel and toolbar", async () => {
  await mountPopup({});
  await act(async () => root.unmount());
  root = createRoot(host);
  let currentQuota: RateLimitInfo = {
    ...limits,
    remaining: 0,
    per_day_remaining: 0,
    bonus_claimed: false,
    email_verified: false,
  };
  vi.mocked(browser.runtime.getURL).mockImplementation((path) => path);
  vi.mocked(browser.windows.create).mockResolvedValue({ id: 8 } as never);
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (raw) => {
    const msg = raw as { type?: string; windowId: number; id: string };
    if (msg.type === "GET_LIMITS") return currentQuota;
    if (msg.type === "GET_PROMPT_LIMIT") return { max_chars: 30000, fallback: false };
    if (msg.type === "REQUEST_EMAIL_BONUS") return { sent: true };
    if (msg.type === "CONFIRM_EMAIL_BONUS") {
      currentQuota = {
        ...limits,
        total: 100,
        per_day_total: 100,
        bonus_claimed: true,
        email_verified: true,
      };
      return currentQuota;
    }
    if (msg.type === "IMPROVE_REQUEST") {
      currentQuota = { ...currentQuota, remaining: 49, per_day_remaining: 49 };
      return { request_id: "new-result", improved_text: "New result", rate_limit: currentQuota };
    }
    if (msg.type === "OPEN_OPTIMIZER_PANEL") return openOptimizerPanel(raw as OpenOptimizerPanel);
    if (msg.type === "CONFIRM_PANEL_HANDOFF") return confirmPanelHandoff(msg.windowId, msg.id);
    return { ok: true };
  });
  await openQuotaWindow("Rejected prompt", undefined, { id: 11 } as never);
  const options = vi.mocked(browser.windows.create).mock.calls.at(-1)![0]!;
  const search = new URL(String(options.url), "https://extension.test").search;
  window.history.replaceState({}, "", `/popup.html${search}`);
  const loaded = await loadSelectionSession(search);
  await act(async () => root.render(<App {...loaded} />));
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  for (const value of ["person@example.com", "123456"]) {
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>(".email-bonus-modal input")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      host.querySelector<HTMLFormElement>(".email-bonus-modal form")!.requestSubmit(),
    );
  }
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await click("New");
  await act(async () => {
    const input = host.querySelector<HTMLTextAreaElement>(".original-textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "New prompt after bonus",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Improve");
  await click("Insert");
  expect(browser.tabs.sendMessage).toHaveBeenCalledWith(11, {
    type: "PASTE_TEXT",
    payload: { text: "New result" },
  });
  vi.mocked(browser.tabs.sendMessage).mockClear();
  await switchSurface(true, "New result");
  activeTab = 42;
  await switchSurface(false, "New result");
  await click("Insert");
  expect(browser.tabs.sendMessage).toHaveBeenCalledWith(11, {
    type: "PASTE_TEXT",
    payload: { text: "New result" },
  });
});
