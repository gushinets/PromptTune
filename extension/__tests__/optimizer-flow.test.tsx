import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { App } from "../entrypoints/popup/App";

let root: Root;
let host: HTMLDivElement;
async function typeOriginal(value: string) {
  await act(async () => {
    const field = host.querySelector(".original-textarea") as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      field,
      value,
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function button(label: string) {
  const result =
    label === "Improve"
      ? host.querySelector<HTMLButtonElement>(".btn-improve")
      : Array.from(host.querySelectorAll("button")).find((item) =>
          item.textContent?.includes(label),
        );
  if (!result) throw new Error(`Missing action ${label}`);
  return result;
}
async function click(label: string) {
  await act(async () => {
    button(label).click();
  });
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    optimizer_browser_session: "test-session",
  });
  vi.mocked(browser.tabs.query).mockResolvedValue([]);
  vi.mocked(browser.tabs.get).mockResolvedValue({ id: 42, url: "https://example.com" } as never);
  vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
  vi.mocked(browser.storage.local.remove).mockResolvedValue(undefined);
  vi.mocked(browser.runtime.getManifest).mockReturnValue({ version: "0.1.0" } as ReturnType<
    typeof browser.runtime.getManifest
  >);
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    installation_id: "i",
    audience_mode: "ai",
    library: [],
  });
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: unknown) => {
    if ((message as { type?: string }).type === "GET_PROMPT_LIMIT")
      return { max_chars: 30000, fallback: false };
    return { ok: true };
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<App />);
  });
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.restoreAllMocks();
});

it("shows input, processing and result screens with edit and new actions", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: unknown) =>
    (message as { type?: string }).type === "IMPROVE_REQUEST"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : { ok: true },
  );
  await typeOriginal("Write a letter");
  await click("Improve");
  expect(host.querySelector(".processing-screen")).not.toBeNull();
  await act(async () => {
    finish({
      type: "IMPROVE_RESULT",
      payload: {
        request_id: "r",
        improved_text: "Improved letter prompt",
        changes: ["Clarified the goal"],
      },
    });
  });
  expect(host.querySelector(".result-screen")?.hasAttribute("hidden")).toBe(false);
  expect(host.querySelector(".improved-textarea")?.textContent).toBe("Improved letter prompt");
  await act(async () => {
    host.querySelector<HTMLButtonElement>('.mode-toggle button[data-mode="ai"]')!.click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
  });
  expect(host.querySelector(".result-screen")?.hasAttribute("hidden")).toBe(false);
  expect(
    vi
      .mocked(browser.runtime.sendMessage)
      .mock.calls.filter(([message]) => (message as { type?: string }).type === "IMPROVE_REQUEST"),
  ).toHaveLength(1);
  await click("Edit original");
  const lastDraft = vi
    .mocked(browser.storage.local.set)
    .mock.calls.filter(([data]) => "popup_session_draft" in data)
    .at(-1)?.[0].popup_session_draft as { optimizer_screen?: string };
  expect(lastDraft.optimizer_screen).toBe("input");
  expect(host.querySelector(".prompt-form")?.hasAttribute("hidden")).toBe(false);
  expect((host.querySelector(".original-textarea") as HTMLTextAreaElement).value).toBe(
    "Write a letter",
  );
  await click("Improve");
  await act(async () => {
    finish({
      type: "IMPROVE_RESULT",
      payload: { request_id: "r2", improved_text: "Second result" },
    });
  });
  await click("New");
  expect((host.querySelector(".original-textarea") as HTMLTextAreaElement).value).toBe("");
  expect(host.querySelector(".result-screen")).toBeNull();
});

it("cancels the real request and ignores a late response", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: unknown) =>
    (message as { type?: string }).type === "IMPROVE_REQUEST"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : { ok: true },
  );
  await typeOriginal("Keep my original");
  await click("Improve");
  await click("Cancel");
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "CANCEL_IMPROVE" }),
  );
  expect((host.querySelector(".original-textarea") as HTMLTextAreaElement).value).toBe(
    "Keep my original",
  );
  await act(async () => {
    finish({
      type: "IMPROVE_RESULT",
      payload: { request_id: "late", improved_text: "Discard me" },
    });
  });
  expect(host.textContent).not.toContain("Discard me");
  expect(host.querySelector(".processing-screen")).toBeNull();
});

it("submits with Ctrl+Enter from the input screen", async () => {
  await typeOriginal("Keyboard prompt");
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
    );
  });
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "IMPROVE_REQUEST" }),
  );
});

it("keeps a new request active when a canceled request finishes late", async () => {
  const finishes: ((value: unknown) => void)[] = [];
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: unknown) =>
    (message as { type?: string }).type === "IMPROVE_REQUEST"
      ? new Promise((resolve) => finishes.push(resolve))
      : { ok: true },
  );
  await typeOriginal("First prompt");
  await click("Improve");
  await click("Cancel");
  await typeOriginal("Second prompt");
  await click("Improve");
  await act(async () => {
    finishes[0]({ type: "IMPROVE_RESULT", payload: { request_id: "old", improved_text: "Old" } });
  });
  expect(host.querySelector(".processing-screen")).not.toBeNull();
  await act(async () => {
    finishes[1]({
      type: "IMPROVE_RESULT",
      payload: { request_id: "new", improved_text: "New result" },
    });
  });
  expect(host.querySelector(".improved-textarea")?.textContent).toBe("New result");
});

it.each([false, undefined, {}])(
  "requires positive insertion acknowledgement: %j",
  async (acknowledgement) => {
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: unknown) =>
      (message as { type?: string }).type === "IMPROVE_REQUEST"
        ? { type: "IMPROVE_RESULT", payload: { request_id: "r", improved_text: "Result" } }
        : { ok: true },
    );
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 1, index: 0, highlighted: true, active: true, pinned: false, incognito: false },
    ]);
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue(
      acknowledgement === false ? { success: false } : acknowledgement,
    );
    await typeOriginal("Prompt");
    await click("Improve");
    await click("Insert");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("No supported input field");
    expect(button("Insert").textContent).not.toContain("Inserted");
    expect(
      vi
        .mocked(browser.runtime.sendMessage)
        .mock.calls.some(
          ([message]) =>
            (message as { payload?: { name?: string } }).payload?.name === "result_copied",
        ),
    ).toBe(false);
  },
);

it("uses the exact selected text instead of a previous result and improves it on demand", async () => {
  await act(async () => root.unmount());
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    audience_mode: "ai",
    library: [],
    popup_session_draft: {
      updatedAt: Date.now(),
      activeTab: "library",
      original: "old",
      improved: "old result",
      changes: [],
      goal: "general",
      lastRequestId: "old-id",
      lastRequestContextKey: null,
      lastModel: null,
      lastLatencyMs: null,
      attemptN: 1,
    },
  });
  root = createRoot(host);
  await act(async () => {
    root.render(
      <App
        initialSelection={{
          text: "  Выделенный 👋\nфрагмент  ",
          sourceTabId: 42,
          sourceSessionId: "test-session",
        }}
      />,
    );
  });
  expect(host.querySelector(".original-textarea")).not.toBeNull();
  expect((host.querySelector(".original-textarea") as HTMLTextAreaElement).value).toBe(
    "  Выделенный 👋\nфрагмент  ",
  );
  expect(host.querySelector(".result-screen")).toBeNull();
  expect(
    vi
      .mocked(browser.runtime.sendMessage)
      .mock.calls.some(([msg]) => (msg as { type?: string }).type === "IMPROVE_REQUEST"),
  ).toBe(false);
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: unknown) =>
    (message as { type: string }).type === "IMPROVE_REQUEST"
      ? {
          type: "IMPROVE_RESULT",
          payload: { request_id: "selection-result", improved_text: "Better selection" },
        }
      : { ok: true },
  );
  await click("Improve");
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "IMPROVE_REQUEST",
      payload: expect.objectContaining({ text: "Выделенный 👋\nфрагмент" }),
    }),
  );
  expect(host.querySelector(".result-screen")?.textContent).toContain("Better selection");
  vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ success: true });
  await click("Insert");
  expect(browser.tabs.sendMessage).toHaveBeenCalledWith(42, {
    type: "PASTE_TEXT",
    payload: { text: "Better selection" },
  });
});

it("restores a selected result in the panel and keeps Insert bound after tab switches", async () => {
  await act(async () => root.unmount());
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    audience_mode: "ai",
    library: [],
    popup_session_draft: {
      updatedAt: Date.now(),
      activeTab: "improve",
      optimizer_screen: "result",
      original: "Selected",
      improved: "Selected result",
      sourceTabId: 42,
      sourceSessionId: "test-session",
      changes: [],
      goal: "general",
      lastRequestId: "selection-result",
      lastRequestContextKey: "ai|general|Selected",
      lastModel: null,
      lastLatencyMs: null,
      attemptN: 1,
    },
  });
  vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 99, url: "https://claude.ai" }] as never);
  vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ success: true });
  root = createRoot(host);
  await act(async () => root.render(<App viewMode="sidepanel" />));
  await act(async () => {
    const activated = vi.mocked(browser.tabs.onActivated.addListener).mock.calls.at(-1)![0];
    activated({ tabId: 99, windowId: 7 });
  });
  await click("Insert");
  expect(browser.tabs.sendMessage).toHaveBeenCalledWith(42, {
    type: "PASTE_TEXT",
    payload: { text: "Selected result" },
  });
  vi.mocked(browser.tabs.get).mockRejectedValue(new Error("Source tab closed"));
  await click("Insert");
  expect(browser.tabs.sendMessage).not.toHaveBeenCalledWith(99, expect.anything());
});

it("clears a restored selection's source binding when starting a new prompt", async () => {
  await act(async () => root.unmount());
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    audience_mode: "ai",
    library: [],
    popup_session_draft: {
      updatedAt: Date.now(),
      activeTab: "improve",
      optimizer_screen: "result",
      original: "Selected",
      improved: "Selected result",
      sourceTabId: 42,
      sourceSessionId: "test-session",
      changes: [],
      goal: "general",
      lastRequestId: "selection-result",
      lastRequestContextKey: "ai|general|Selected",
      lastModel: null,
      lastLatencyMs: null,
      attemptN: 1,
    },
  });
  vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 99 }] as never);
  vi.mocked(browser.tabs.get).mockRejectedValue(new Error("Source tab closed"));
  vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ success: true });
  root = createRoot(host);
  await act(async () => root.render(<App />));
  await click("New");
  await typeOriginal("A new prompt");
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: unknown) =>
    (message as { type: string }).type === "IMPROVE_REQUEST"
      ? {
          type: "IMPROVE_RESULT",
          payload: { request_id: "new-result", improved_text: "New result" },
        }
      : { ok: true },
  );
  await click("Improve");
  await click("Insert");
  expect(browser.tabs.sendMessage).toHaveBeenCalledWith(99, {
    type: "PASTE_TEXT",
    payload: { text: "New result" },
  });
  expect(browser.storage.local.set).toHaveBeenLastCalledWith({
    popup_session_draft: expect.objectContaining({
      sourceTabId: undefined,
      original: "A new prompt",
    }),
  });
});

it("keeps the normal browser target after New in a standalone selection window", async () => {
  await act(async () => root.unmount());
  vi.mocked(browser.tabs.query).mockResolvedValue([
    { id: 100, windowId: 100, url: "chrome-extension://test/popup.html" },
  ] as never);
  vi.mocked(browser.tabs.get).mockResolvedValue({
    id: 42,
    windowId: 7,
    url: "https://chatgpt.com",
  } as never);
  vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ success: true });
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: unknown) =>
    (message as { type: string }).type === "IMPROVE_REQUEST"
      ? { type: "IMPROVE_RESULT", payload: { request_id: "r", improved_text: "Result" } }
      : { ok: true },
  );
  root = createRoot(host);
  await act(async () =>
    root.render(
      <App
        initialSelection={{ text: "First", sourceTabId: 42, sourceSessionId: "test-session" }}
      />,
    ),
  );
  await click("Improve");
  await click("New");
  await typeOriginal("Second");
  await click("Improve");
  await click("Insert");
  expect(browser.tabs.sendMessage).toHaveBeenCalledWith(42, {
    type: "PASTE_TEXT",
    payload: { text: "Result" },
  });
  const open = vi.fn().mockResolvedValue(undefined);
  Object.assign(browser, { sidePanel: { open } });
  vi.spyOn(window, "close").mockImplementation(() => {});
  await act(async () => host.querySelector<HTMLButtonElement>(".layout-toggle-btn")!.click());
  expect(open).toHaveBeenCalledWith({ windowId: 7 });
  expect(browser.tabs.sendMessage).not.toHaveBeenCalledWith(100, expect.anything());
});

it("refuses a restored source tab when its browser session has ended, even if the ID is reused", async () => {
  await act(async () => root.unmount());
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    audience_mode: "ai",
    library: [],
    popup_session_draft: {
      updatedAt: Date.now(),
      activeTab: "improve",
      optimizer_screen: "result",
      original: "Old selected text",
      improved: "Old result",
      sourceTabId: 42,
      sourceSessionId: "previous-session",
      changes: [],
      goal: "general",
      lastRequestId: "old",
      lastRequestContextKey: "ai|general|Old selected text",
      lastModel: null,
      lastLatencyMs: null,
      attemptN: 1,
    },
  });
  vi.mocked(browser.tabs.get).mockResolvedValue({
    id: 42,
    windowId: 9,
    url: "https://claude.ai/new-conversation",
  } as never);
  vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ success: true });
  root = createRoot(host);
  await act(async () => root.render(<App />));
  await click("Insert");
  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "original browser session has ended",
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Copy");
});
