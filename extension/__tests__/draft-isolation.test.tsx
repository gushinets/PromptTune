import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import type { PopupSessionDraft } from "../shared/storage";
import { loadSelectionSession } from "../shared/selection";
import { App } from "../entrypoints/popup/App";

let state: Record<string, unknown>;
const roots = new Set<Root>();
const hosts: HTMLElement[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    optimizer_browser_session: "test-session",
  });
  vi.mocked(browser.windows.getCurrent).mockResolvedValue({ id: 7 } as never);
  state = { audience_mode: "ai", library: [] };
  vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ ...state }));
  vi.mocked(browser.storage.local.set).mockImplementation(async (values) => {
    Object.assign(state, values);
  });
  vi.mocked(browser.storage.local.remove).mockImplementation(async (keys) => {
    for (const key of [keys].flat()) delete state[key];
  });
  vi.mocked(browser.tabs.query).mockResolvedValue([]);
  vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ ok: true });
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.clear();
  hosts.splice(0).forEach((host) => host.remove());
  vi.restoreAllMocks();
});
function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const root = createRoot(host);
  roots.add(root);
  return { host, root };
}
it.each(["popup", "sidepanel"] as const)(
  "keeps independent %s and selection drafts when the older surface edits last",
  async (viewMode) => {
    const a = mount();
    const b = mount();
    const draft = {
      draftSessionId: "session-a",
      draftCreatedAt: 100,
      activeTab: "improve" as const,
      original: "Selection A",
      improved: "",
      changes: [],
      goal: "general" as const,
      lastRequestId: null,
      lastRequestContextKey: null,
      lastModel: null,
      lastLatencyMs: null,
      attemptN: 0,
    };
    await act(async () =>
      a.root.render(
        viewMode === "popup" ? (
          <App
            initialSelection={{
              text: "Selection A",
              draftSessionId: "session-a",
              draftCreatedAt: 100,
            }}
          />
        ) : (
          <App viewMode="sidepanel" initialDraft={draft} />
        ),
      ),
    );
    await act(async () =>
      b.root.render(
        <App
          initialSelection={{
            text: "Selection B",
            draftSessionId: "session-b",
            draftCreatedAt: 200,
          }}
        />,
      ),
    );
    await act(async () => {
      const field = a.host.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        field,
        "Edited A",
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      a.root.unmount();
      b.root.unmount();
    });
    roots.delete(a.root);
    roots.delete(b.root);
    const reopened = mount();
    await act(async () => reopened.root.render(<App />));
    expect((reopened.host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "Selection B",
    );
    expect(state["optimizer_draft_session-a"]).toMatchObject({ original: "Edited A" });
  },
);

it("restores the panel's session once after an explicit switch, despite a newer live session", async () => {
  const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
  const a = mount();
  const b = mount();
  await act(async () =>
    a.root.render(
      <App
        viewMode="sidepanel"
        initialSelection={{
          text: "Selection A",
          draftSessionId: "a",
          draftCreatedAt: 100,
        }}
      />,
    ),
  );
  await act(async () =>
    b.root.render(
      <App
        initialSelection={{
          text: "Selection B",
          draftSessionId: "b",
          draftCreatedAt: 200,
        }}
      />,
    ),
  );
  await act(async () => {
    a.host.querySelector<HTMLButtonElement>(".layout-toggle-btn")!.click();
  });
  expect(close).toHaveBeenCalledOnce();
  // A different panel or explicit selection must not consume the toolbar handoff.
  const otherPanel = mount();
  await act(async () => otherPanel.root.render(<App viewMode="sidepanel" />));
  expect(otherPanel.host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Selection B");
  const selection = mount();
  await act(async () =>
    selection.root.render(
      <App initialSelection={{ text: "Selection C", draftSessionId: "c", draftCreatedAt: 150 }} />,
    ),
  );
  const reloadedSelection = mount();
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", "?selection=optimizer_selection_consumed");
  try {
    await act(async () => reloadedSelection.root.render(<App />));
    expect(reloadedSelection.host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
  } finally {
    window.history.replaceState(null, "", originalUrl);
  }
  const reopened = mount();
  await act(async () => reopened.root.render(<App />));
  expect(reopened.host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Selection A");
  const later = mount();
  await act(async () => later.root.render(<App />));
  expect(later.host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Selection B");
});

it.each(["missing", "expired", "read failure"])(
  "does not restore another saved session after a %s selection handoff",
  async (failure) => {
    const saved = mount();
    await act(async () =>
      saved.root.render(
        <App
          initialSelection={{
            text: "Unrelated saved B",
            draftSessionId: "saved-b",
            draftCreatedAt: 200,
          }}
        />,
      ),
    );
    state.optimizer_selection_a =
      failure === "expired" ? { text: "Selected A", expiresAt: Date.now() - 1 } : undefined;
    if (failure === "expired")
      state.optimizer_draft_a = {
        ...(state["optimizer_draft_saved-b"] as PopupSessionDraft),
        draftSessionId: "a",
        updatedAt: Date.now() - 3 * 60 * 60 * 1000 - 1,
      };
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", "?selection=optimizer_selection_a");
    try {
      if (failure === "read failure")
        vi.mocked(browser.storage.local.get).mockRejectedValueOnce(
          new Error("Storage read failed"),
        );
      const props = await loadSelectionSession(window.location.search);
      expect(props.initialSelection).toBeUndefined();
      expect(props.initialDraft).toBeUndefined();
      const launched = mount();
      await act(async () => launched.root.render(<App {...props} />));
      expect(launched.host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
      expect(launched.host.textContent).not.toContain("Unrelated saved B");
      expect(launched.host.textContent).toContain("select the text again");
      expect(launched.host.querySelector<HTMLButtonElement>(".btn-improve")!.disabled).toBe(true);
      expect(launched.host.querySelector(".result-screen")).toBeNull();
    } finally {
      window.history.replaceState(null, "", originalUrl);
    }
    const toolbar = mount();
    await act(async () => toolbar.root.render(<App />));
    expect(toolbar.host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
      "Unrelated saved B",
    );
  },
);

it("autosaves user input after a failed selection launch, including clearing that input", async () => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", "?selection=optimizer_selection_missing");
  const launched = mount();
  try {
    await act(async () => launched.root.render(<App />));
    expect(Object.keys(state).filter((key) => key.startsWith("optimizer_draft_"))).toHaveLength(0);
    for (const text of ["New prompt after failed selection", ""]) {
      await act(async () => {
        const field = launched.host.querySelector<HTMLTextAreaElement>("textarea")!;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          field,
          text,
        );
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const saved = Object.entries(state).find(([key]) => key.startsWith("optimizer_draft_"));
      expect(saved?.[1]).toMatchObject({ original: text });
    }
  } finally {
    window.history.replaceState(null, "", originalUrl);
  }
});

it.each(["popup", "sidepanel"] as const)(
  "restores mode and goal together in %s after another live session changes the global mode",
  async (surface) => {
    const a = mount();
    await act(async () =>
      a.root.render(
        <App initialSelection={{ text: "Session A", draftSessionId: "a", draftCreatedAt: 200 }} />,
      ),
    );
    await act(async () => a.host.querySelector<HTMLInputElement>('input[value="claude"]')!.click());
    const b = mount();
    await act(async () =>
      b.root.render(
        <App initialSelection={{ text: "Session B", draftSessionId: "b", draftCreatedAt: 100 }} />,
      ),
    );
    await act(async () =>
      b.host.querySelector<HTMLButtonElement>('[data-mode="content"]')!.click(),
    );
    expect(state.audience_mode).toBe("content");
    const reopened = mount();
    await act(async () =>
      reopened.root.render(
        surface === "popup" ? (
          <App />
        ) : (
          <App viewMode="sidepanel" initialDraft={state.optimizer_draft_a as PopupSessionDraft} />
        ),
      ),
    );
    expect(reopened.host.querySelector('[data-mode="ai"]')?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(reopened.host.querySelector<HTMLInputElement>('input[value="claude"]')!.checked).toBe(
      true,
    );
    vi.mocked(browser.runtime.sendMessage).mockClear();
    await act(async () => reopened.host.querySelector<HTMLButtonElement>(".btn-improve")!.click());
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "IMPROVE_REQUEST",
        payload: expect.objectContaining({
          audience_mode: "ai",
          goal: "claude",
          text: "Session A",
        }),
      }),
    );
  },
);
it("remaps an incompatible legacy goal before submitting in the global mode", async () => {
  state.audience_mode = "content";
  state.popup_session_draft = {
    activeTab: "improve",
    original: "Legacy session",
    improved: "",
    changes: [],
    goal: "claude",
    lastRequestId: null,
    lastRequestContextKey: null,
    lastModel: null,
    lastLatencyMs: null,
    attemptN: 0,
    updatedAt: Date.now(),
  };
  const reopened = mount();
  await act(async () => reopened.root.render(<App />));
  expect(reopened.host.querySelector<HTMLInputElement>('input[value="general"]')!.checked).toBe(
    true,
  );
  await act(async () => reopened.host.querySelector<HTMLButtonElement>(".btn-improve")!.click());
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "IMPROVE_REQUEST",
      payload: expect.objectContaining({ audience_mode: "content", goal: "general" }),
    }),
  );
});

it("reloads the same selection session with its edits, result, mode and source binding", async () => {
  const search = "?selection=optimizer_selection_a&session=a";
  state.optimizer_selection_a = {
    text: "Selected A",
    draftSessionId: "a",
    draftCreatedAt: 100,
    sourceTabId: 42,
    sourceSessionId: "test-session",
    expiresAt: Date.now() + 300000,
  };
  const firstLaunch = await loadSelectionSession(search);
  expect(state.optimizer_selection_a).toBeUndefined();
  const a = mount();
  await act(async () => a.root.render(<App {...firstLaunch} />));
  await act(async () => {
    const field = a.host.querySelector<HTMLTextAreaElement>("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      field,
      "Edited A",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
    a.host.querySelector<HTMLInputElement>('input[value="claude"]')!.click();
  });
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: unknown) =>
    (message as { type?: string }).type === "IMPROVE_REQUEST"
      ? { type: "IMPROVE_RESULT", payload: { request_id: "a-result", improved_text: "Result A" } }
      : { ok: true },
  );
  await act(async () => a.host.querySelector<HTMLButtonElement>(".btn-improve")!.click());
  expect(a.host.querySelector(".result-screen")?.textContent).toContain("Result A");
  const b = mount();
  await act(async () =>
    b.root.render(
      <App initialSelection={{ text: "Newer B", draftSessionId: "b", draftCreatedAt: 200 }} />,
    ),
  );
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", search);
  try {
    const props = await loadSelectionSession(search);
    expect(
      (await loadSelectionSession("?selection=optimizer_selection_a")).initialDraft,
    ).toMatchObject({ original: "Edited A" });
    const reloaded = mount();
    await act(async () => reloaded.root.render(<App {...props} />));
    expect(reloaded.host.textContent).toContain("Edited A");
    expect(reloaded.host.querySelector(".result-screen")?.textContent).toContain("Result A");
    expect(reloaded.host.textContent).not.toContain("Newer B");
    expect(reloaded.host.querySelector('[role="alert"]')).toBeNull();
    expect(props.initialDraft).toMatchObject({
      audienceMode: "ai",
      goal: "claude",
      sourceTabId: 42,
      sourceSessionId: "test-session",
    });
  } finally {
    window.history.replaceState(null, "", originalUrl);
  }
});

it.each(["test-session", "next-browser-session"])(
  "Selection → Improve → New → Improve → Reload → Insert (browser session: %s)",
  async (browserSession) => {
    const search = "?selection=optimizer_selection_a&session=a";
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", search);
    state.optimizer_selection_a = {
      text: "Selected prompt",
      draftSessionId: "a",
      draftCreatedAt: 100,
      sourceTabId: 42,
      sourceSessionId: "test-session",
      expiresAt: Date.now() + 300000,
    };
    vi.mocked(browser.tabs.get).mockResolvedValue({
      id: 42,
      windowId: 7,
      url: "https://chatgpt.com",
    } as never);
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 99, windowId: 9, url: "chrome-extension://optimizer/popup.html" },
    ] as never);
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ success: true });
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: unknown) => {
      const msg = message as { type?: string; payload?: { text: string } };
      return msg.type === "IMPROVE_REQUEST"
        ? {
            type: "IMPROVE_RESULT",
            payload: {
              request_id: crypto.randomUUID(),
              improved_text: `Improved: ${msg.payload!.text}`,
            },
          }
        : { ok: true };
    });
    try {
      const first = mount();
      const launch = await loadSelectionSession(search);
      await act(async () => first.root.render(<App {...launch} />));
      await act(async () => first.host.querySelector<HTMLButtonElement>(".btn-improve")!.click());
      expect(first.host.querySelector(".result-screen")?.textContent).toContain(
        "Improved: Selected prompt",
      );
      await act(async () => first.host.querySelector<HTMLButtonElement>(".btn-new")!.click());
      await act(async () => {
        const field = first.host.querySelector<HTMLTextAreaElement>(".original-textarea")!;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          field,
          "Another prompt",
        );
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => first.host.querySelector<HTMLButtonElement>(".btn-improve")!.click());
      expect(first.host.querySelector(".result-screen")?.textContent).toContain(
        "Improved: Another prompt",
      );
      expect((state.optimizer_draft_a as PopupSessionDraft).sourceTabId).toBeUndefined();
      expect((state.optimizer_draft_a as PopupSessionDraft).sourceSessionId).toBeUndefined();
      await act(async () => first.root.unmount());
      roots.delete(first.root);
      const reloaded = mount();
      const restored = await loadSelectionSession(search);
      await act(async () => reloaded.root.render(<App {...restored} />));
      vi.mocked(browser.storage.session.get).mockResolvedValue({
        optimizer_browser_session: browserSession,
      });
      vi.mocked(browser.tabs.sendMessage).mockClear();
      vi.mocked(browser.tabs.query).mockClear();
      await act(async () =>
        Array.from(reloaded.host.querySelectorAll("button"))
          .find((button) => button.textContent?.includes("Insert"))!
          .click(),
      );
      if (browserSession === "test-session") {
        expect(browser.tabs.sendMessage).toHaveBeenCalledWith(42, {
          type: "PASTE_TEXT",
          payload: { text: "Improved: Another prompt" },
        });
      } else {
        expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
        expect(reloaded.host.textContent).toContain("original browser session has ended");
      }
      expect(browser.tabs.query).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState(null, "", originalUrl);
    }
  },
);

it("does not apply a saved standalone target to a normal toolbar popup after New", async () => {
  state.optimizer_draft_a = {
    draftSessionId: "a",
    draftCreatedAt: 100,
    updatedAt: Date.now(),
    audienceMode: "ai",
    activeTab: "improve",
    optimizer_screen: "result",
    original: "New prompt",
    improved: "New result",
    standaloneTarget: { tabId: 42, sessionId: "test-session" },
    changes: [],
    goal: "general",
    lastRequestId: "a",
    lastRequestContextKey: "ai|general|New prompt",
    lastModel: null,
    lastLatencyMs: null,
    attemptN: 1,
  };
  vi.mocked(browser.tabs.query).mockResolvedValue([
    { id: 99, windowId: 7, url: "https://claude.ai" },
  ] as never);
  vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ success: true });
  const toolbar = mount();
  await act(async () => toolbar.root.render(<App />));
  await act(async () =>
    Array.from(toolbar.host.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Insert"))!
      .click(),
  );
  expect(browser.tabs.sendMessage).toHaveBeenCalledWith(99, {
    type: "PASTE_TEXT",
    payload: { text: "New result" },
  });
  expect(browser.tabs.sendMessage).not.toHaveBeenCalledWith(42, expect.anything());
});
