import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { LIMITS } from "../shared/constants";
import { expectPanelHandoff, expectedPanelHandoffs } from "../shared/panel-handoff";
import { SidepanelApp } from "../entrypoints/sidepanel/SidepanelApp";

let host: HTMLDivElement;
let root: Root;
const selected = {
  browserSessionId: "test-session",
  id: "selection-session",
  expiresAt: Date.now() + 300000,
  draft: {
    sourceTabId: 42,
    sourceSessionId: "test-session",
    optimizer_screen: "result",
    result_context: { mode: "ai", goal: "general" },
    activeTab: "improve",
    original: "Selected text",
    improved: "Improved selection",
    changes: [],
    goal: "general",
    lastRequestId: "selected-result",
    lastRequestContextKey: "ai|general|Selected text",
    lastModel: null,
    lastLatencyMs: null,
    attemptN: 1,
  },
};

async function change(key: string, value: unknown) {
  await act(async () => {
    const listener = vi.mocked(browser.storage.onChanged.addListener).mock.calls.at(-1)![0];
    listener({ [key]: { newValue: value } }, "local");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(browser.storage.session.remove).mockResolvedValue(undefined);
  vi.mocked(browser.storage.session.set).mockResolvedValue(undefined);
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    optimizer_browser_session: "test-session",
  });
  vi.mocked(browser.windows.getCurrent).mockResolvedValue({ id: 7 } as never);
  vi.mocked(browser.tabs.get).mockResolvedValue({ id: 42, url: "https://chatgpt.com" } as never);
  vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 99, url: "https://claude.ai" }] as never);
  vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ success: true });
  vi.mocked(browser.storage.local.get).mockResolvedValue({ audience_mode: "ai", library: [] });
  vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
  vi.mocked(browser.storage.local.remove).mockResolvedValue(undefined);
  vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ ok: true });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it("loads a handoff when a new panel starts and retains the source for Insert", async () => {
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    audience_mode: "ai",
    library: [],
    "optimizer_panel_handoff_7_selection-session": selected,
  });
  await act(async () => root.render(<SidepanelApp />));
  expect(host.querySelector(".result-screen")?.textContent).toContain("Improved selection");
  expect(browser.storage.local.remove).toHaveBeenCalledWith(
    "optimizer_panel_handoff_7_selection-session",
  );
  await act(async () => {
    Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Insert"))!
      .click();
  });
  expect(browser.tabs.sendMessage).toHaveBeenCalledWith(42, {
    type: "PASTE_TEXT",
    payload: { text: "Improved selection" },
  });
});

it("updates an already-open panel only for handoffs addressed to its window", async () => {
  await act(async () => root.render(<SidepanelApp />));
  await change("optimizer_panel_handoff_8_other-session", selected);
  expect(host.querySelector(".result-screen")).toBeNull();
  await change("optimizer_panel_handoff_7_selection-session", selected);
  expect(host.querySelector(".result-screen")?.textContent).toContain("Improved selection");
  // A second selection must replace the displayed session, rather than restore its old result.
  await change("optimizer_panel_handoff_7_second-selection", {
    browserSessionId: "test-session",
    id: "second-selection",
    expiresAt: Date.now() + 300000,
    draft: {
      ...selected.draft,
      original: "Second selection",
      improved: "",
      optimizer_screen: "input",
    },
  });
  expect(host.querySelector(".result-screen")).toBeNull();
  expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Second selection");
});

it("renders the normal app when the initial handoff read fails", async () => {
  vi.mocked(browser.storage.local.get).mockRejectedValueOnce(new Error("storage failed"));
  await act(async () => root.render(<SidepanelApp />));
  expect(host.querySelector(".original-textarea")).not.toBeNull();
  await change("optimizer_panel_handoff_7_selection-session", selected);
  expect(host.querySelector(".result-screen")?.textContent).toContain("Improved selection");
});

it.each(["expired", "legacy"])(
  "does not restore a %s panel handoff at startup or from an event",
  async (kind) => {
    const stale = { ...selected, expiresAt: kind === "expired" ? Date.now() - 1 : undefined };
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      audience_mode: "ai",
      library: [],
      "optimizer_panel_handoff_7_selection-session": stale,
    });
    await act(async () => root.render(<SidepanelApp />));
    expect(host.querySelector(".result-screen")).toBeNull();
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
    await change("optimizer_panel_handoff_7_selection-session", selected);
    expect(host.querySelector(".result-screen")?.textContent).toContain("Improved selection");
    await change("optimizer_panel_handoff_7_selection-session", {
      ...stale,
      draft: { ...selected.draft, improved: "Stale result" },
    });
    expect(host.querySelector(".result-screen")?.textContent).toContain("Improved selection");
    expect(host.querySelector(".result-screen")?.textContent).not.toContain("Stale result");
  },
);

it("takes the newest pending handoff and retires older payloads so reopening cannot replay them", async () => {
  const olderKey = "optimizer_panel_handoff_7_older";
  const newerKey = "optimizer_panel_handoff_7_newer";
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    audience_mode: "ai",
    library: [],
    [olderKey]: { ...selected, id: "older", expiresAt: Date.now() + 60000 },
    [newerKey]: {
      ...selected,
      id: "newer",
      expiresAt: Date.now() + 300000,
      draft: { ...selected.draft, improved: "Newest result" },
    },
    optimizer_panel_handoff_8_other: { ...selected },
  });
  await act(async () => root.render(<SidepanelApp />));
  expect(host.querySelector(".result-screen")?.textContent).toContain("Newest result");
  expect(browser.storage.local.remove).toHaveBeenCalledWith(newerKey);
  expect(browser.storage.local.remove).toHaveBeenCalledWith([olderKey]);
  expect(browser.storage.local.remove).not.toHaveBeenCalledWith([
    "optimizer_panel_handoff_8_other",
  ]);
});

it("does not let cleanup deletion events discard a live handoff during startup", async () => {
  let finishRead!: (value: Record<string, unknown>) => void;
  let initialRead = true;
  vi.mocked(browser.storage.local.get).mockImplementation(async (key) => {
    if (key === null && initialRead) {
      initialRead = false;
      return new Promise((resolve) => {
        finishRead = resolve;
      });
    }
    return { audience_mode: "ai", library: [] };
  });
  await act(async () => root.render(<SidepanelApp />));
  await change("optimizer_panel_handoff_7_expired", undefined);
  await act(async () =>
    finishRead({
      optimizer_panel_handoff_7_live: selected,
      optimizer_panel_handoff_7_expired: { ...selected, expiresAt: Date.now() - 1 },
    }),
  );
  expect(host.querySelector(".result-screen")?.textContent).toContain("Improved selection");
});

it("retries the initial read to recover a handoff written before subscription", async () => {
  vi.mocked(browser.storage.local.get).mockRejectedValueOnce(new Error("temporary read failure"));
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    audience_mode: "ai",
    library: [],
    "optimizer_panel_handoff_7_selection-session": selected,
  });
  await act(async () => root.render(<SidepanelApp />));
  expect(host.querySelector(".result-screen")?.textContent).toContain("Improved selection");
});

it("shows a recoverable error instead of an unrelated draft when both initial reads fail", async () => {
  vi.mocked(browser.storage.local.get)
    .mockRejectedValueOnce(new Error("read failed"))
    .mockRejectedValueOnce(new Error("retry failed"));
  await act(async () => root.render(<SidepanelApp />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not load the transferred prompt",
  );
  expect(host.querySelector("textarea")).toBeNull();
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    audience_mode: "ai",
    library: [],
    "optimizer_panel_handoff_7_selection-session": selected,
  });
  await act(async () => host.querySelector("button")!.click());
  expect(host.querySelector(".result-screen")?.textContent).toContain("Improved selection");
});

it("keeps two active browser windows on their own transferred sessions", async () => {
  await act(async () => root.render(<SidepanelApp />));
  const secondHost = document.createElement("div");
  document.body.appendChild(secondHost);
  const secondRoot = createRoot(secondHost);
  vi.mocked(browser.windows.getCurrent).mockResolvedValue({ id: 8 } as never);
  try {
    await act(async () => secondRoot.render(<SidepanelApp />));
    const listeners = vi
      .mocked(browser.storage.onChanged.addListener)
      .mock.calls.map(([listener]) => listener);
    const deliver = async (key: string, value: unknown) => {
      await act(async () => {
        for (const listener of listeners) listener({ [key]: { newValue: value } }, "local");
      });
    };
    await deliver("optimizer_panel_handoff_7_first", selected);
    await deliver("optimizer_panel_handoff_8_second", {
      ...selected,
      id: "second",
      draft: { ...selected.draft, improved: "Window eight result" },
    });
    expect(host.querySelector(".result-screen")?.textContent).toContain("Improved selection");
    expect(secondHost.querySelector(".result-screen")?.textContent).toContain(
      "Window eight result",
    );
  } finally {
    await act(async () => secondRoot.unmount());
    secondHost.remove();
  }
});

it("closes only the addressed panel when a transfer fails on a browser without native close", async () => {
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  await act(async () => root.render(<SidepanelApp />));
  await change("optimizer_panel_handoff_7_selection-session", selected);
  const listener = vi.mocked(browser.runtime.onMessage.addListener).mock.calls.at(-1)![0];
  await listener({ type: "PANEL_HANDOFF_FAILED", windowId: 8 }, {} as never, vi.fn());
  expect(close).not.toHaveBeenCalled();
  await listener(
    {
      type: "PANEL_HANDOFF_FAILED",
      windowId: 7,
      openedAfter: 0,
      failedHandoffId: "selection-session",
    },
    {} as never,
    vi.fn(),
  );
  expect(close).toHaveBeenCalledOnce();
});

it("closes a newly opened panel after a rejected handoff write even during delayed startup", async () => {
  let finishWindow!: (value: { id: number }) => void;
  vi.mocked(browser.windows.getCurrent).mockReturnValue(
    new Promise((resolve) => {
      finishWindow = resolve;
    }) as never,
  );
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: unknown) => {
    for (const [listener] of vi.mocked(browser.runtime.onMessage.addListener).mock.calls) {
      const result = listener(message, {} as never, vi.fn());
      if (result !== undefined) await result;
    }
    // Emulate the background listener winning the direct response channel.
    return undefined;
  });
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  const { requestPanelRollback } = await import("../shared/panel-handoff");
  const { setOptimizerHandoff } = await import("../shared/storage");
  vi.mocked(browser.storage.local.set).mockRejectedValueOnce(new Error("Handoff write failed"));
  await expect(setOptimizerHandoff("optimizer_panel_handoff_7_failed-A", selected)).rejects.toThrow(
    "Handoff write failed",
  );
  const cleanup = requestPanelRollback(7, 0, "failed-A");
  try {
    await act(async () => root.render(<SidepanelApp />));
    expect(close).not.toHaveBeenCalled();
    await act(async () => finishWindow({ id: 7 }));
    expect(close).toHaveBeenCalledOnce();
    const requests = vi
      .mocked(browser.runtime.sendMessage)
      .mock.calls.filter(
        ([msg]) => (msg as { type?: string }).type === "PANEL_HANDOFF_FAILED",
      ).length;
    await act(async () => {
      await browser.runtime.sendMessage({ type: "PANEL_READY", windowId: 7 });
    });
    expect(close).toHaveBeenCalledOnce();
    expect(
      vi
        .mocked(browser.runtime.sendMessage)
        .mock.calls.filter(([msg]) => (msg as { type?: string }).type === "PANEL_HANDOFF_FAILED"),
    ).toHaveLength(requests);
  } finally {
    cleanup();
  }
});

it("preserves an already-open panel and its edits when another optimizer's transfer fails", async () => {
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  await act(async () => root.render(<SidepanelApp />));
  await act(async () => {
    const field = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      field,
      "Previous panel edits",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const listener = vi.mocked(browser.runtime.onMessage.addListener).mock.calls.at(-1)![0];
  await act(async () => {
    await listener(
      { type: "PANEL_HANDOFF_FAILED", windowId: 7, openedAfter: Date.now() + 1000 },
      {} as never,
      vi.fn(),
    );
  });
  expect(close).not.toHaveBeenCalled();
  expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
    "Previous panel edits",
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("previous session");
});

it("preserves a different accepted handoff when an older failed transfer rolls back", async () => {
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  await act(async () => root.render(<SidepanelApp />));
  await change("optimizer_panel_handoff_7_selection-session", selected);
  const listener = vi.mocked(browser.runtime.onMessage.addListener).mock.calls.at(-1)![0];
  await act(async () => {
    await listener(
      { type: "PANEL_HANDOFF_FAILED", windowId: 7, openedAfter: 0, failedHandoffId: "failed-A" },
      {} as never,
      vi.fn(),
    );
  });
  expect(close).not.toHaveBeenCalled();
  expect(host.querySelector(".result-screen")?.textContent).toContain("Improved selection");
});

it("rechecks transfer ownership after a delayed rollback acknowledgement", async () => {
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  await act(async () => root.render(<SidepanelApp />));
  await change("optimizer_panel_handoff_7_failed-A", { ...selected, id: "failed-A" });
  let acknowledge!: () => void;
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: unknown) => {
    if ((message as { type?: string }).type === "PANEL_ROLLBACK_ACK")
      return new Promise<void>((resolve) => {
        acknowledge = resolve;
      });
    return { ok: true };
  });
  const listener = vi.mocked(browser.runtime.onMessage.addListener).mock.calls.at(-1)![0];
  let handled!: unknown;
  await act(async () => {
    handled = listener(
      { type: "PANEL_HANDOFF_FAILED", windowId: 7, openedAfter: 0, failedHandoffId: "failed-A" },
      {} as never,
      vi.fn(),
    );
  });
  await change("optimizer_panel_handoff_7_new-B", {
    ...selected,
    id: "new-B",
    draft: { ...selected.draft, improved: "B result" },
  });
  await act(async () => {
    acknowledge();
    await handled;
  });
  expect(close).not.toHaveBeenCalled();
  expect(host.querySelector(".result-screen")?.textContent).toContain("B result");
});

it.each(["previous-browser", undefined])(
  "does not accept stale or unversioned panel transfers after window ID reuse (%s)",
  async (staleSession) => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      audience_mode: "ai",
      library: [],
      optimizer_panel_handoff_7_old: { ...selected, browserSessionId: staleSession },
    });
    await act(async () => root.render(<SidepanelApp />));
    expect(host.textContent).not.toContain("Improved selection");
    await change("optimizer_panel_handoff_7_old", { ...selected, browserSessionId: staleSession });
    expect(host.textContent).not.toContain("Improved selection");
  },
);

it("loads a panel handoff without a full-store scan or unrelated payloads in its snapshot", async () => {
  const data: Record<string, unknown> = {
    audience_mode: "ai",
    library: [
      { id: "library-entry", createdAt: 1, original: "l".repeat(6 * 1024 * 1024), improved: "" },
    ],
    pending_library_saves: [{ original: "p".repeat(1024 * 1024) }],
    optimizer_panel_handoff_7_selection: selected,
    optimizer_panel_handoff_8_other: {
      ...selected,
      draft: { ...selected.draft, improved: "Other window" },
    },
  };
  Object.assign(browser.storage.local, { getKeys: vi.fn(async () => Object.keys(data)) });
  vi.mocked(browser.storage.local.get).mockImplementation(async (keys) => {
    if (keys === null || keys === undefined)
      throw new Error("Full-store scan during panel startup");
    if (
      Array.isArray(keys) &&
      keys.some(
        (key) =>
          key === "library" ||
          key === "pending_library_saves" ||
          key.startsWith("optimizer_panel_handoff_8_"),
      )
    )
      throw new Error("Unrelated payload in handoff snapshot");
    return Object.fromEntries([keys].flat().map((key) => [key, data[key as string]]));
  });
  try {
    await act(async () => root.render(<SidepanelApp />));
    expect(host.textContent).toContain("Improved selection");
    expect(host.textContent).not.toContain("Other window");
    expect(browser.storage.local.get).toHaveBeenCalledWith(["optimizer_panel_handoff_7_selection"]);
  } finally {
    Reflect.deleteProperty(browser.storage.local, "getKeys");
  }
});

it.each(["expired", "removed"])(
  "does not mount an unrelated draft after failed reads and a %s transfer on Retry",
  async (state) => {
    vi.mocked(browser.storage.session.get).mockResolvedValue({
      optimizer_browser_session: "test-session",
      optimizer_panel_intent_7_expected: { createdAt: Date.now() },
    });
    vi.mocked(browser.storage.local.get)
      .mockRejectedValueOnce(new Error("Read failed"))
      .mockRejectedValueOnce(new Error("Retry read failed"));
    await act(async () => root.render(<SidepanelApp />));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      audience_mode: "ai",
      library: [],
      ...(state === "expired"
        ? { optimizer_panel_handoff_7_old: { ...selected, expiresAt: Date.now() - 1 } }
        : {}),
      optimizer_draft_other: {
        ...selected.draft,
        original: "Unrelated B",
        improved: "Unrelated B result",
        draftSessionId: "other",
        draftCreatedAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector(".popup-container")).toBeNull();
    expect(host.textContent).not.toContain("Unrelated B");
    await change("optimizer_panel_handoff_7_recovered", selected);
    expect(host.querySelector(".result-screen")?.textContent).toContain("Improved selection");
  },
);

it("can retry an ordinary panel into a fresh editor without substituting another draft", async () => {
  vi.mocked(browser.storage.local.get)
    .mockRejectedValueOnce(new Error("read failed"))
    .mockRejectedValueOnce(new Error("retry failed"));
  await act(async () => root.render(<SidepanelApp />));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    audience_mode: "ai",
    library: [],
    optimizer_draft_other: {
      ...selected.draft,
      original: "Other session B",
      improved: "Other result B",
      draftSessionId: "b",
      draftCreatedAt: Date.now(),
      updatedAt: Date.now(),
    },
  });
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.querySelector(".popup-container")).not.toBeNull();
  expect(host.querySelector<HTMLTextAreaElement>(".original-textarea")!.value).toBe("");
  expect(host.textContent).not.toContain("Other session B");
});

it("keeps an existing editor when transfer intent is queued but the transfer never commits", async () => {
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    audience_mode: "ai",
    library: [],
    optimizer_panel_handoff_7_initial: selected,
  });
  await act(async () => root.render(<SidepanelApp />));
  const incoming = {
    ...selected,
    id: "failed-open",
    draft: { ...selected.draft, improved: "Must not replace prior editor" },
  };
  await act(async () => {
    const listener = vi.mocked(browser.storage.onChanged.addListener).mock.calls.at(-1)![0];
    listener({ optimizer_panel_intent_7_failed: { newValue: incoming } }, "session");
    listener({ optimizer_panel_intent_7_failed: { newValue: undefined } }, "session");
  });
  expect(host.querySelector(".result-screen")?.textContent).toContain("Improved selection");
  expect(host.textContent).not.toContain("Must not replace prior editor");
});

it("timestamps transfer intent before opening the panel", async () => {
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  await expectPanelHandoff(7, "new-transfer");
  expect(browser.storage.session.set).toHaveBeenCalledWith({
    "optimizer_panel_intent_7_new-transfer": { createdAt: now },
  });
});

it("prunes abandoned intents after the handoff lifetime and grace while retaining live transfers", async () => {
  const now = Date.now();
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    optimizer_browser_session: "test-session",
    optimizer_panel_intent_7_expired: { createdAt: now - LIMITS.HANDOFF_TTL_MS - 61000 },
    optimizer_panel_intent_7_publishing: { createdAt: now - LIMITS.HANDOFF_TTL_MS - 30000 },
    optimizer_panel_intent_7_fresh: { createdAt: now },
    optimizer_panel_intent_7_legacy: true,
    optimizer_panel_intent_7_invalid: { createdAt: "invalid" },
    optimizer_panel_intent_8_expired: { createdAt: 0 },
  });
  const pending = await expectedPanelHandoffs(7);
  expect(pending).toEqual([
    { key: "optimizer_panel_intent_7_publishing", expiresAt: now + 30000 },
    { key: "optimizer_panel_intent_7_fresh", expiresAt: now + LIMITS.HANDOFF_TTL_MS + 60000 },
  ]);
  expect(browser.storage.session.remove).toHaveBeenCalledWith([
    "optimizer_panel_intent_7_expired",
    "optimizer_panel_intent_7_legacy",
    "optimizer_panel_intent_7_invalid",
  ]);
});

it.each(["missing", "read-failed"])(
  "lets Retry leave %s transfer recovery after its intent lifetime without restoring another draft",
  async (failure) => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    vi.mocked(browser.storage.session.get).mockResolvedValue({
      optimizer_browser_session: "test-session",
      optimizer_panel_intent_7_abandoned: { createdAt: now },
    });
    if (failure === "read-failed")
      vi.mocked(browser.storage.local.get)
        .mockRejectedValueOnce(new Error("read failed"))
        .mockRejectedValueOnce(new Error("retry read failed"));
    await act(async () => root.render(<SidepanelApp />));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      audience_mode: "ai",
      library: [],
      optimizer_draft_other: {
        ...selected.draft,
        original: "Other session B",
        draftSessionId: "b",
        draftCreatedAt: now,
        updatedAt: now,
      },
    });
    clock.mockReturnValue(now + LIMITS.HANDOFF_TTL_MS + 30000);
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    vi.mocked(browser.storage.session.get).mockResolvedValue({
      optimizer_browser_session: "test-session",
    });
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    clock.mockReturnValue(now + LIMITS.HANDOFF_TTL_MS + 61000);
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(host.querySelector(".popup-container")).not.toBeNull();
    expect(host.querySelector<HTMLTextAreaElement>(".original-textarea")!.value).toBe("");
    expect(host.textContent).not.toContain("Other session B");
  },
);

it("starts fresh if an observed intent expires during the initial storage read", async () => {
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    optimizer_browser_session: "test-session",
    optimizer_panel_intent_7_slow: { createdAt: now },
  });
  vi.mocked(browser.storage.local.get).mockImplementation(async () => {
    clock.mockReturnValue(now + LIMITS.HANDOFF_TTL_MS + 61000);
    return {
      audience_mode: "ai",
      library: [],
      optimizer_draft_other: {
        ...selected.draft,
        original: "Other session B",
        draftSessionId: "b",
        draftCreatedAt: now,
        updatedAt: now,
      },
    };
  });
  await act(async () => root.render(<SidepanelApp />));
  expect(host.querySelector(".popup-container")).not.toBeNull();
  expect(host.querySelector<HTMLTextAreaElement>(".original-textarea")?.value).toBe("");
  expect(host.textContent).not.toContain("Other session B");
});
