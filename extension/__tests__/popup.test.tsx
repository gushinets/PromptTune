import { openOptimizerPanel, type OpenOptimizerPanel } from "../shared/panel-handoff";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { ApiError, apiClient } from "@shared/api-client";
import { FEATURES, LIMITS } from "@shared/constants";
import { App } from "../entrypoints/popup/App";

function flushEffects() {
  return act(async () => {
    await Promise.resolve();
  });
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  );

  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`);
  }

  return match;
}

function getImproveButton(container: HTMLElement): HTMLButtonElement {
  const match = container.querySelector(".btn-improve");
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error("Improve action button not found.");
  }

  return match;
}

function selectGoal(container: HTMLElement, goal: string) {
  const radio = container.querySelector(`input[type="radio"][value="${goal}"]`);
  if (!(radio instanceof HTMLInputElement)) {
    throw new Error(`Goal radio not found: ${goal}`);
  }

  radio.click();
}

async function selectMode(container: HTMLElement, mode: "ai" | "content") {
  const target =
    container.querySelector(`.mode-toggle button[data-mode="${mode}"]`) ??
    container.querySelector(`.mode-onboarding-card[data-mode="${mode}"]`);
  if (!(target instanceof HTMLButtonElement)) throw new Error(`Mode action not found: ${mode}`);
  await act(async () => {
    target.click();
    await Promise.resolve();
  });
}

async function setOriginalPrompt(container: HTMLElement, value: string) {
  const originalField = container.querySelector("textarea");
  if (!(originalField instanceof HTMLTextAreaElement)) {
    throw new Error("Original prompt field not found.");
  }

  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;

    if (!valueSetter) {
      throw new Error("Textarea value setter not found.");
    }

    valueSetter.call(originalField, value);
    originalField.dispatchEvent(new Event("input", { bubbles: true }));
    originalField.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("App", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(browser.storage.session.remove).mockResolvedValue(undefined);
    vi.mocked(browser.storage.session.set).mockResolvedValue(undefined);
    vi.mocked(browser.storage.session.get).mockResolvedValue({
      optimizer_browser_session: "test-session",
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T12:00:00.000Z"));
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      installation_id: "install-1",
      library: [],
      audience_mode: "ai",
    });
    vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
    vi.mocked(browser.storage.local.remove).mockResolvedValue(undefined);
    vi.mocked(browser.runtime.getManifest).mockReturnValue({
      version: "0.1.0",
    } as ReturnType<typeof browser.runtime.getManifest>);
    vi.mocked(browser.tabs.query).mockResolvedValue([] as never);
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) => {
      const typed = msg as { type?: string };
      if (typed.type === "OPEN_OPTIMIZER_PANEL")
        return openOptimizerPanel(msg as OpenOptimizerPanel);
      if (typed.type === "GET_LIMITS") {
        return {
          type: "LIMITS_RESULT",
          payload: {
            rate_limit: {
              per_minute_remaining: 4,
              per_day_remaining: 10,
              per_minute_total: 5,
              per_day_total: 10,
            },
          },
        };
      }
      return { ok: true };
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([
    { total: 0, visible: "5", description: "5 today" },
    { total: 50, visible: "5/50", description: "5/50 today" },
  ])(
    "renders the quota badge consistently for total=$total",
    async ({ total, visible, description }) => {
      vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) =>
        (msg as { type?: string }).type === "GET_LIMITS"
          ? {
              type: "LIMITS_RESULT",
              payload: {
                rate_limit: {
                  per_minute_remaining: 5,
                  per_minute_total: 5,
                  per_day_remaining: 5,
                  per_day_total: total,
                },
              },
            }
          : { ok: true },
      );
      await act(async () => {
        root.render(<App />);
      });
      await flushEffects();
      const badge = container.querySelector(".rate-limit-badge");
      expect(badge?.querySelector('[aria-hidden="true"]')?.textContent).toBe(visible);
      expect(badge?.querySelector(".sr-only")?.textContent).toBe(description);
      expect(badge?.getAttribute("title")).toBe(description);
    },
  );

  it("recovers from a temporary 429 after cancel when the refunded quota becomes available", async () => {
    let remaining = 1;
    let improvements = 0;
    let finishCanceled!: (value: unknown) => void;
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) => {
      const type = (msg as { type?: string }).type;
      if (type === "GET_LIMITS")
        return {
          type: "LIMITS_RESULT",
          payload: {
            rate_limit: {
              per_day_remaining: remaining,
              per_day_total: 1,
              per_minute_remaining: remaining,
              per_minute_total: 5,
            },
          },
        };
      if (type === "IMPROVE_REQUEST") {
        improvements++;
        if (improvements === 1) {
          remaining = 0;
          return new Promise((resolve) => {
            finishCanceled = resolve;
          });
        }
        if (remaining === 0) throw new ApiError(429, "Rate limit exceeded");
        return {
          type: "IMPROVE_RESULT",
          payload: { request_id: "after-refund", improved_text: "Recovered result" },
        };
      }
      return { ok: true };
    });
    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    await setOriginalPrompt(container, "Keep my original");
    await act(async () => {
      getImproveButton(container).click();
    });
    await act(async () => {
      findButton(container, "Cancel").click();
      finishCanceled(undefined);
    });
    // The backend has observed abort but has not refunded its last reservation yet.
    await act(async () => {
      getImproveButton(container).click();
    });
    expect(improvements).toBe(2);
    expect(container.querySelector(".upgrade-banner")).not.toBeNull();
    // While quota is still zero, retry checks the server rather than POSTing again.
    await act(async () => {
      getImproveButton(container).click();
    });
    expect(improvements).toBe(2);
    remaining = 1;
    await act(async () => {
      getImproveButton(container).click();
    });
    expect(improvements).toBe(3);
    expect((container.querySelector(".improved-textarea") as HTMLTextAreaElement)?.value).toBe(
      "Recovered result",
    );
    expect(container.querySelector(".upgrade-banner")).toBeNull();
    expect(container.querySelector(".error-toast")).toBeNull();
  });

  it("does not submit after canceling a pending quota refresh or on duplicate clicks", async () => {
    let queries = 0;
    let finishRefresh!: (value: unknown) => void;
    const limits = (remaining: number) => ({
      type: "LIMITS_RESULT",
      payload: {
        rate_limit: {
          per_day_remaining: remaining,
          per_day_total: 1,
          per_minute_remaining: remaining,
          per_minute_total: 5,
        },
      },
    });
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) => {
      if ((msg as { type?: string }).type === "GET_LIMITS") {
        queries++;
        return queries === 1
          ? limits(0)
          : new Promise((resolve) => {
              finishRefresh = resolve;
            });
      }
      return { ok: true };
    });
    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    await setOriginalPrompt(container, "Keep my prompt");
    await act(async () => {
      getImproveButton(container).click();
      getImproveButton(container).click();
    });
    expect(queries).toBe(2);
    await act(async () => {
      findButton(container, "Cancel").click();
      finishRefresh(limits(1));
    });
    expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "IMPROVE_REQUEST" }),
    );
    expect(container.querySelector(".processing-screen")).toBeNull();
    expect((container.querySelector(".original-textarea") as HTMLTextAreaElement).value).toBe(
      "Keep my prompt",
    );
  });

  it.each(["exhausted", "failed"])(
    "preserves a successful result when exhausted-quota revalidation is %s",
    async (outcome) => {
      let queries = 0;
      const quota = {
        per_day_remaining: 0,
        per_day_total: 1,
        per_minute_remaining: 4,
        per_minute_total: 5,
      };
      vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) => {
        const type = (msg as { type?: string }).type;
        if (type === "GET_LIMITS") {
          if (++queries > 1 && outcome === "failed") throw new Error("Failed to fetch");
          return {
            type: "LIMITS_RESULT",
            payload: { rate_limit: { ...quota, per_day_remaining: queries === 1 ? 1 : 0 } },
          };
        }
        if (type === "IMPROVE_REQUEST")
          return {
            type: "IMPROVE_RESULT",
            payload: {
              request_id: "last-success",
              improved_text: "Keep this successful result",
              changes: ["Keep this explanation"],
              rate_limit: quota,
            },
          };
        return { ok: true };
      });
      await act(async () => {
        root.render(<App />);
      });
      await flushEffects();
      await setOriginalPrompt(container, "Original | prompt");
      await act(async () => {
        getImproveButton(container).click();
      });
      await act(async () => {
        findButton(container, "Edit original").click();
      });
      await setOriginalPrompt(container, "Edited original prompt");
      await act(async () => {
        getImproveButton(container).click();
      });
      expect(
        vi
          .mocked(browser.runtime.sendMessage)
          .mock.calls.filter(([msg]) => (msg as { type?: string }).type === "IMPROVE_REQUEST"),
      ).toHaveLength(1);
      expect((container.querySelector(".improved-textarea") as HTMLTextAreaElement)?.value).toBe(
        "Keep this successful result",
      );
      expect(container.textContent).toContain("Keep this explanation");
      expect((container.querySelector(".result-screen") as HTMLElement).hidden).toBe(false);
      expect(findButton(container, "Copy").closest("[hidden]")).toBeNull();
      expect(findButton(container, "Save to Library").closest("[hidden]")).toBeNull();
      expect(findButton(container, "Copy").disabled).toBe(false);
      expect(findButton(container, "Save to Library").disabled).toBe(false);
      expect((container.querySelector(".original-textarea") as HTMLTextAreaElement).value).toBe(
        "Edited original prompt",
      );
      const draft = vi
        .mocked(browser.storage.local.set)
        .mock.calls.flatMap(([data]) => Object.entries(data))
        .filter(([key]) => key.startsWith("optimizer_draft_"))
        .at(-1)?.[1] as {
        improved: string;
        changes: string[];
        optimizer_screen: string;
      };
      expect(draft).toMatchObject({
        improved: "Keep this successful result",
        changes: ["Keep this explanation"],
        optimizer_screen: "result",
      });
      await act(async () => {
        root.unmount();
      });
      const restoredData: Record<string, unknown> = {
        installation_id: "i",
        audience_mode: "ai",
        library: [],
        popup_session_draft: { ...draft, updatedAt: Date.now() },
      };
      vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ ...restoredData }));
      vi.mocked(browser.storage.local.set).mockImplementation(async (value) => {
        Object.assign(restoredData, value);
      });
      root = createRoot(container);
      await act(async () => {
        root.render(<App />);
      });
      await flushEffects();
      expect((container.querySelector(".result-screen") as HTMLElement).hidden).toBe(false);
      expect(findButton(container, "Copy").closest("[hidden]")).toBeNull();
      expect(findButton(container, "Save to Library").closest("[hidden]")).toBeNull();
      const saveSpy = vi.spyOn(apiClient, "savePrompt").mockResolvedValue({ prompt_id: "saved" });
      await act(async () => {
        findButton(container, "Save to Library").click();
      });
      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          original_text: "Original | prompt",
          improved_text: "Keep this successful result",
        }),
      );
      expect(restoredData.library).toEqual([
        expect.objectContaining({
          original: "Original | prompt",
          improved: "Keep this successful result",
        }),
      ]);
      expect(container.textContent).toContain("Saved!");
    },
  );

  it("keeps the submitted goal during processing and after sidepanel tab switches", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 1, url: "https://claude.ai/new" },
    ] as never);
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) =>
      (msg as { type?: string }).type === "IMPROVE_REQUEST"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : { ok: true },
    );
    await act(async () => {
      root.render(<App viewMode="sidepanel" />);
    });
    await flushEffects();
    await setOriginalPrompt(container, "Optimize for Claude");
    await act(async () => {
      getImproveButton(container).click();
    });
    const activation = vi.mocked(browser.tabs.onActivated.addListener).mock.calls[0][0];
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 2, url: "https://chatgpt.com" },
    ] as never);
    await act(async () => {
      activation({ tabId: 2, windowId: 1 });
    });
    expect(container.querySelector(".processing-context")?.textContent).toContain("Claude");
    expect(container.querySelector(".processing-context")?.textContent).not.toContain("ChatGPT");
    await act(async () => {
      finish({
        type: "IMPROVE_RESULT",
        payload: { request_id: "claude-result", improved_text: "Claude-optimized prompt" },
      });
    });
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 3, url: "https://www.perplexity.ai" },
    ] as never);
    await act(async () => {
      activation({ tabId: 3, windowId: 1 });
    });
    expect(container.querySelector(".goal-badge")?.textContent).toBe("Claude");
    const draft = vi
      .mocked(browser.storage.local.set)
      .mock.calls.flatMap(([data]) => Object.entries(data))
      .filter(([key]) => key.startsWith("optimizer_draft_"))
      .at(-1)?.[1];
    expect(draft).toMatchObject({
      goal: "perplexity",
      result_context: { mode: "ai", goal: "claude" },
    });
    await act(async () => {
      findButton(container, "Edit original").click();
    });
    expect((container.querySelector('input[value="perplexity"]') as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it.each([true, false])(
    "restores the completed request's goal separately from the next-input goal (saved context: %s)",
    async (hasSavedContext) => {
      vi.mocked(browser.storage.local.get).mockResolvedValue({
        installation_id: "i",
        audience_mode: "ai",
        library: [],
        popup_session_draft: {
          activeTab: "improve",
          optimizer_screen: "result",
          original: "Original",
          improved: "Claude result",
          changes: [],
          goal: "chatgpt",
          result_context: hasSavedContext ? { mode: "ai", goal: "claude" } : undefined,
          lastRequestId: "r",
          lastRequestContextKey: "ai|claude|Original",
          lastModel: null,
          lastLatencyMs: null,
          attemptN: 1,
          updatedAt: Date.now(),
        },
      });
      await act(async () => {
        root.render(<App viewMode="sidepanel" />);
      });
      await flushEffects();
      expect(container.querySelector(".goal-badge")?.textContent).toBe("Claude");
      expect((container.querySelector('input[value="chatgpt"]') as HTMLInputElement).checked).toBe(
        true,
      );
    },
  );

  it.each(["popup", "sidepanel"] as const)(
    "prevents a mid-flight switch from %s without relying on unmount",
    async (viewMode) => {
      const close = vi.spyOn(window, "close").mockImplementation(() => {});
      const open = vi.fn().mockResolvedValue(undefined);
      Object.assign(browser, { sidePanel: { open } });
      vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 1, windowId: 1 }] as never);
      vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) =>
        (msg as { type?: string }).type === "IMPROVE_REQUEST"
          ? new Promise(() => {})
          : { ok: true },
      );
      await act(async () => {
        root.render(<App viewMode={viewMode} />);
      });
      await flushEffects();
      await setOriginalPrompt(container, "Pending prompt");
      await act(async () => {
        getImproveButton(container).click();
      });
      const toggle = container.querySelector(".layout-toggle-btn") as HTMLButtonElement;
      expect(toggle.disabled).toBe(true);
      await act(async () => {
        toggle.click();
      });
      expect(close).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    },
  );

  it("blocks submission while a popup-to-panel transition is pending", async () => {
    let finishOpen!: () => void;
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    Object.assign(browser, {
      sidePanel: {
        open: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              finishOpen = resolve;
            }),
        ),
      },
    });
    vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 1, windowId: 1 }] as never);
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) =>
      (msg as { type?: string }).type === "OPEN_OPTIMIZER_PANEL"
        ? openOptimizerPanel(msg as OpenOptimizerPanel)
        : (msg as { type?: string }).type === "IMPROVE_REQUEST"
          ? new Promise(() => {})
          : { ok: true },
    );
    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    await setOriginalPrompt(container, "Pending prompt");
    await act(async () => {
      (container.querySelector(".layout-toggle-btn") as HTMLButtonElement).click();
    });
    await act(async () => {
      getImproveButton(container).click();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
    });
    expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "IMPROVE_REQUEST" }),
    );
    expect(getImproveButton(container).disabled).toBe(true);
    await act(async () => {
      finishOpen();
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".processing-screen")).toBeNull();
  });

  it.each(["popup", "sidepanel"] as const)(
    "locks input edits during a deferred %s surface transfer",
    async (viewMode) => {
      const close = vi.spyOn(window, "close").mockImplementation(() => {});
      let finish!: () => void;
      Object.assign(browser, {
        sidePanel: {
          open: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                finish = resolve;
              }),
          ),
        },
      });
      vi.mocked(browser.windows.getCurrent).mockResolvedValue({ id: 7 } as never);
      vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 1, windowId: 7 }] as never);
      await act(async () => root.render(<App viewMode={viewMode} />));
      await flushEffects();
      await setOriginalPrompt(container, "Prompt A");
      if (viewMode === "sidepanel")
        vi.mocked(browser.storage.local.set).mockImplementation(async (values) => {
          if (Object.keys(values).some((key) => key.startsWith("optimizer_popup_handoff_")))
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
        });
      await act(async () =>
        (container.querySelector(".layout-toggle-btn") as HTMLButtonElement).click(),
      );
      try {
        const field = container.querySelector<HTMLTextAreaElement>(".original-textarea")!;
        expect(field.readOnly || field.disabled).toBe(true);
        await setOriginalPrompt(container, "Prompt B");
        expect(field.value).toBe("Prompt A");
        expect((container.querySelector(".tab-bar button") as HTMLButtonElement).disabled).toBe(
          true,
        );
      } finally {
        await act(async () => finish());
      }
      expect(close).toHaveBeenCalledOnce();
      const handoff = vi
        .mocked(browser.storage.local.set)
        .mock.calls.flatMap(([values]) => Object.entries(values))
        .find(([key]) =>
          key.startsWith(
            viewMode === "popup" ? "optimizer_panel_handoff_" : "optimizer_popup_handoff_",
          ),
        );
      expect(handoff?.[1]).toMatchObject({ draft: { original: "Prompt A" } });
    },
  );

  it.each(["popup", "sidepanel"] as const)(
    "locks result editing and actions during a deferred %s result transfer",
    async (viewMode) => {
      const close = vi.spyOn(window, "close").mockImplementation(() => {});
      const previousOpenAndPaste = FEATURES.OPEN_AND_PASTE;
      Object.assign(FEATURES, { OPEN_AND_PASTE: true });
      const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      const savePrompt = vi
        .spyOn(apiClient, "savePrompt")
        .mockResolvedValue({ prompt_id: "saved" });
      let finish!: () => void;
      Object.assign(browser, {
        sidePanel: {
          open: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                finish = resolve;
              }),
          ),
        },
      });
      vi.mocked(browser.windows.getCurrent).mockResolvedValue({ id: 7 } as never);
      vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 1, windowId: 7 }] as never);
      const initialDraft = {
        activeTab: "improve" as const,
        original: "Prompt A",
        improved: "Result A",
        changes: [],
        goal: "general" as const,
        lastRequestId: "r",
        lastRequestContextKey: "ai|general|Prompt A",
        lastModel: null,
        lastLatencyMs: null,
        attemptN: 1,
      };
      await act(async () => root.render(<App viewMode={viewMode} initialDraft={initialDraft} />));
      await flushEffects();
      if (viewMode === "sidepanel")
        vi.mocked(browser.storage.local.set).mockImplementation(async (values) => {
          if (Object.keys(values).some((key) => key.startsWith("optimizer_popup_handoff_")))
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
        });
      await act(async () =>
        (container.querySelector(".layout-toggle-btn") as HTMLButtonElement).click(),
      );
      try {
        const edit = container.querySelector<HTMLButtonElement>(".btn-edit")!;
        const startNew = container.querySelector<HTMLButtonElement>(".btn-new")!;
        expect(edit.disabled).toBe(true);
        expect(startNew.disabled).toBe(true);
        const actions = [
          ...container.querySelectorAll<HTMLButtonElement>(".action-bar button, .site-icon-btn"),
        ];
        expect(actions).toHaveLength(8);
        expect(actions.every((button) => button.disabled)).toBe(true);
        await act(async () => {
          actions.forEach((button) => button.click());
        });
        expect(writeText).not.toHaveBeenCalled();
        expect(savePrompt).not.toHaveBeenCalled();
        expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
        expect(
          vi
            .mocked(browser.runtime.sendMessage)
            .mock.calls.some(
              ([message]) => (message as { type?: string }).type === "OPEN_AND_PASTE",
            ),
        ).toBe(false);
        await act(async () => {
          edit.click();
          startNew.click();
        });
        expect(container.querySelector(".result-screen")?.textContent).toContain("Result A");
      } finally {
        await act(async () => finish());
        Object.assign(FEATURES, { OPEN_AND_PASTE: previousOpenAndPaste });
        if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
        else Reflect.deleteProperty(navigator, "clipboard");
      }
      expect(close).toHaveBeenCalledOnce();
      const handoff = vi
        .mocked(browser.storage.local.set)
        .mock.calls.flatMap(([values]) => Object.entries(values))
        .find(([key]) =>
          key.startsWith(
            viewMode === "popup" ? "optimizer_panel_handoff_" : "optimizer_popup_handoff_",
          ),
        );
      expect(handoff?.[1]).toMatchObject({ draft: { original: "Prompt A", improved: "Result A" } });
    },
  );

  it("blocks the side-panel toggle until its transferred draft finishes restoring", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    vi.mocked(browser.windows.getCurrent).mockResolvedValue({ id: 7 } as never);
    let finishMode!: () => void;
    vi.mocked(browser.storage.local.get).mockImplementation(async (key) => {
      if (key === "audience_mode") {
        await new Promise<void>((resolve) => {
          finishMode = resolve;
        });
        return { audience_mode: "ai" };
      }
      return { library: [] };
    });
    const initialDraft = {
      activeTab: "improve" as const,
      original: "Transferred A",
      improved: "Transferred result A",
      changes: [],
      goal: "general" as const,
      lastRequestId: "a",
      lastRequestContextKey: "ai|general|Transferred A",
      lastModel: null,
      lastLatencyMs: null,
      attemptN: 1,
    };
    await act(async () => root.render(<App viewMode="sidepanel" initialDraft={initialDraft} />));
    const toggle = container.querySelector<HTMLButtonElement>(".layout-toggle-btn")!;
    try {
      expect(toggle.disabled).toBe(true);
      await act(async () => toggle.click());
      expect(close).not.toHaveBeenCalled();
      expect(
        vi
          .mocked(browser.storage.local.set)
          .mock.calls.some(([values]) =>
            Object.keys(values).some((key) => key.startsWith("optimizer_popup_handoff_")),
          ),
      ).toBe(false);
    } finally {
      await act(async () => finishMode());
    }
    expect(toggle.disabled).toBe(false);
    await act(async () => toggle.click());
    const handoff = vi
      .mocked(browser.storage.local.set)
      .mock.calls.flatMap(([values]) => Object.entries(values))
      .find(([key]) => key.startsWith("optimizer_popup_handoff_"));
    expect(handoff?.[1]).toMatchObject({
      draft: { original: "Transferred A", improved: "Transferred result A" },
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("allows submission again if opening the sidepanel fails", async () => {
    Object.assign(browser, {
      sidePanel: { open: vi.fn().mockRejectedValue(new Error("Open failed")) },
    });
    vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 1, windowId: 1 }] as never);
    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    await setOriginalPrompt(container, "Retry prompt");
    await act(async () => {
      (container.querySelector(".layout-toggle-btn") as HTMLButtonElement).click();
    });
    expect(getImproveButton(container).disabled).toBe(false);
    expect(container.querySelector<HTMLTextAreaElement>(".original-textarea")!.readOnly).toBe(
      false,
    );
    await act(async () => {
      getImproveButton(container).click();
    });
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "IMPROVE_REQUEST" }),
    );
  });

  it("explains a closed source tab without closing or retargeting the selection", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const open = vi.fn().mockResolvedValue(undefined);
    Object.assign(browser, { sidePanel: { open } });
    vi.mocked(browser.tabs.get).mockRejectedValue(new Error("No tab with id: 42"));
    await act(async () => {
      root.render(
        <App
          initialSelection={{
            text: "Selected text",
            sourceTabId: 42,
            sourceSessionId: "test-session",
          }}
        />,
      );
    });
    await flushEffects();
    await act(async () => {
      (container.querySelector(".layout-toggle-btn") as HTMLButtonElement).click();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not open the side panel",
    );
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "Selected text",
    );
    expect(close).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(browser.tabs.query).not.toHaveBeenCalled();
  });

  it("hands the selected session and source tab to the target window before closing", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const open = vi.fn().mockResolvedValue(undefined);
    Object.assign(browser, { sidePanel: { open } });
    vi.mocked(browser.tabs.get).mockResolvedValue({ id: 42, windowId: 7 } as never);
    await act(async () => {
      root.render(
        <App
          initialSelection={{
            text: "Selected text",
            sourceTabId: 42,
            sourceSessionId: "test-session",
          }}
        />,
      );
    });
    await flushEffects();
    await act(async () => {
      (container.querySelector(".layout-toggle-btn") as HTMLButtonElement).click();
    });
    expect(open).toHaveBeenCalledWith({ windowId: 7 });
    const handoff = vi
      .mocked(browser.storage.local.set)
      .mock.calls.flatMap(([values]) => Object.entries(values))
      .find(([key]) => key.startsWith("optimizer_panel_handoff_7_"));
    expect(handoff).toBeDefined();
    expect(handoff![1]).toEqual(
      expect.objectContaining({
        expiresAt: Date.now() + 300000,
        draft: expect.objectContaining({ original: "Selected text", sourceTabId: 42 }),
      }),
    );
    expect(handoff![0]).toBe(`optimizer_panel_handoff_7_${(handoff![1] as { id: string }).id}`);
    expect(close).toHaveBeenCalledOnce();
  });

  it("finishes the background handoff after Chrome unmounts the toolbar popup", async () => {
    let finishOpen!: () => void;
    Object.assign(browser, {
      sidePanel: {
        open: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              finishOpen = resolve;
            }),
        ),
      },
    });
    vi.spyOn(window, "close").mockImplementation(() => {});
    vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 1, windowId: 7 }] as never);
    await act(async () => root.render(<App />));
    await flushEffects();
    await setOriginalPrompt(container, "Survive toolbar destruction");
    await act(async () =>
      (container.querySelector(".layout-toggle-btn") as HTMLButtonElement).click(),
    );
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "OPEN_OPTIMIZER_PANEL",
        draft: expect.objectContaining({ original: "Survive toolbar destruction" }),
      }),
    );
    await act(async () => root.unmount());
    await act(async () => finishOpen());
    expect(
      vi
        .mocked(browser.storage.local.set)
        .mock.calls.flatMap(([values]) => Object.entries(values))
        .find(([key]) => key.startsWith("optimizer_panel_handoff_7_"))?.[1],
    ).toMatchObject({ draft: { original: "Survive toolbar destruction" } });
  });

  it("shows a layout failure while the Library tab remains open", async () => {
    const open = vi.fn().mockRejectedValue(new Error("Panel unavailable"));
    Object.assign(browser, { sidePanel: { open } });
    vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 1, windowId: 7 }] as never);
    await act(async () => root.render(<App />));
    await flushEffects();
    await act(async () => findButton(container, "Library").click());
    await act(async () =>
      (container.querySelector(".layout-toggle-btn") as HTMLButtonElement).click(),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not open the side panel",
    );
    expect(container.querySelector(".tab.active")?.textContent).toContain("Library");
  });

  it("closes the opened panel if persisting its selected session fails and keeps the optimizer open", async () => {
    const closeWindow = vi.spyOn(window, "close").mockImplementation(() => {});
    const open = vi.fn().mockResolvedValue(undefined);
    const closePanel = vi.fn().mockResolvedValue(undefined);
    Object.assign(browser, { sidePanel: { open, close: closePanel } });
    vi.mocked(browser.tabs.get).mockResolvedValue({ id: 42, windowId: 7 } as never);
    await act(async () =>
      root.render(
        <App
          initialSelection={{ text: "Keep me", sourceTabId: 42, sourceSessionId: "test-session" }}
        />,
      ),
    );
    await flushEffects();
    vi.mocked(browser.storage.local.set).mockImplementation(async (values) => {
      if (Object.keys(values).some((key) => key.startsWith("optimizer_panel_handoff_")))
        throw new Error("write failed");
    });
    await act(async () =>
      (container.querySelector(".layout-toggle-btn") as HTMLButtonElement).click(),
    );
    expect(open).toHaveBeenCalledWith({ windowId: 7 });
    expect(closePanel).not.toHaveBeenCalled();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PANEL_HANDOFF_FAILED",
        windowId: 7,
        openedAfter: expect.any(Number),
      }),
    );
    expect(closeWindow).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not open the side panel",
    );
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Keep me");
  });

  it("calls sidePanel.open synchronously from the click using the prevalidated target", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    Object.assign(browser, { sidePanel: { open } });
    vi.spyOn(window, "close").mockImplementation(() => {});
    vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 1, windowId: 7 }] as never);
    await act(async () => root.render(<App />));
    await flushEffects();
    await act(async () => {
      (container.querySelector(".layout-toggle-btn") as HTMLButtonElement).click();
      expect(open).toHaveBeenCalledWith({ windowId: 7 });
      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "OPEN_OPTIMIZER_PANEL" }),
      );
    });
  });

  it("keeps the validated source usable while an unrelated update triggers a pending refresh", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    Object.assign(browser, { sidePanel: { open } });
    vi.spyOn(window, "close").mockImplementation(() => {});
    vi.mocked(browser.tabs.get).mockResolvedValue({ id: 42, windowId: 7 } as never);
    await act(async () =>
      root.render(
        <App
          initialSelection={{ text: "Selected", sourceTabId: 42, sourceSessionId: "test-session" }}
        />,
      ),
    );
    await flushEffects();
    let finish!: (value: { id: number; windowId: number }) => void;
    vi.mocked(browser.tabs.get).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
    );
    const updated = vi.mocked(browser.tabs.onUpdated.addListener).mock.calls.at(-1)![0];
    await act(async () => updated(99, { status: "loading" }, { id: 99 } as never));
    const toggle = container.querySelector(".layout-toggle-btn") as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    await act(async () => {
      toggle.click();
      expect(open).toHaveBeenCalledWith({ windowId: 7 });
    });
    await act(async () => finish({ id: 42, windowId: 7 }));
  });

  it("disables the popup layout toggle until its first target validation finishes", async () => {
    let finish!: (value: { id: number; windowId: number }[]) => void;
    vi.mocked(browser.tabs.query).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
    );
    await act(async () => root.render(<App />));
    await flushEffects();
    const toggle = container.querySelector(".layout-toggle-btn") as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    await act(async () => finish([{ id: 1, windowId: 7 }]));
    expect(toggle.disabled).toBe(false);
  });

  it("keeps the optimizer open and rolls back if its source closes while the panel is opening", async () => {
    const closeWindow = vi.spyOn(window, "close").mockImplementation(() => {});
    let finishOpen!: () => void;
    const open = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishOpen = resolve;
        }),
    );
    Object.assign(browser, { sidePanel: { open } });
    vi.mocked(browser.tabs.get).mockResolvedValue({ id: 42, windowId: 7 } as never);
    await act(async () =>
      root.render(
        <App
          initialSelection={{
            text: "Keep this selection",
            sourceTabId: 42,
            sourceSessionId: "test-session",
          }}
        />,
      ),
    );
    await flushEffects();
    await act(async () =>
      (container.querySelector(".layout-toggle-btn") as HTMLButtonElement).click(),
    );
    const removed = vi.mocked(browser.tabs.onRemoved.addListener).mock.calls.at(-1)![0];
    await act(async () => removed(42, { windowId: 7, isWindowClosing: false }));
    await act(async () => finishOpen());
    expect(closeWindow).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(browser.storage.local.set)
        .mock.calls.some(([values]) =>
          Object.keys(values).some((key) => key.startsWith("optimizer_panel_handoff_")),
        ),
    ).toBe(false);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "PANEL_HANDOFF_FAILED", windowId: 7 }),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not open the side panel",
    );
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "Keep this selection",
    );
  });

  it("uses the new browser window immediately when the source tab moves during revalidation", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    Object.assign(browser, { sidePanel: { open } });
    vi.spyOn(window, "close").mockImplementation(() => {});
    vi.mocked(browser.tabs.get).mockResolvedValue({ id: 42, windowId: 7 } as never);
    await act(async () =>
      root.render(
        <App
          initialSelection={{ text: "Selected", sourceTabId: 42, sourceSessionId: "test-session" }}
        />,
      ),
    );
    await flushEffects();
    let finish!: (value: { id: number; windowId: number }) => void;
    vi.mocked(browser.tabs.get).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
    );
    const attached = vi.mocked(browser.tabs.onAttached.addListener).mock.calls.at(-1)![0];
    await act(async () => attached(42, { newWindowId: 8, newPosition: 0 }));
    await act(async () => {
      (container.querySelector(".layout-toggle-btn") as HTMLButtonElement).click();
      expect(open).toHaveBeenCalledWith({ windowId: 8 });
    });
    await act(async () => finish({ id: 42, windowId: 8 }));
  });

  it("does not resurrect a source removed before its initial validation resolves", async () => {
    vi.spyOn(window, "close").mockImplementation(() => {});
    const open = vi.fn().mockResolvedValue(undefined);
    Object.assign(browser, { sidePanel: { open } });
    let finish!: (value: { id: number; windowId: number }) => void;
    vi.mocked(browser.tabs.get).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
    );
    await act(async () =>
      root.render(
        <App
          initialSelection={{ text: "Selected", sourceTabId: 42, sourceSessionId: "test-session" }}
        />,
      ),
    );
    await flushEffects();
    const removed = vi.mocked(browser.tabs.onRemoved.addListener).mock.calls.at(-1)![0];
    await act(async () => removed(42, { windowId: 7, isWindowClosing: false }));
    await act(async () => finish({ id: 42, windowId: 7 }));
    await act(async () =>
      (container.querySelector(".layout-toggle-btn") as HTMLButtonElement).click(),
    );
    expect(open).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not open the side panel",
    );
  });

  it("hands an ordinary popup's own session to the panel even when a newer draft exists", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    Object.assign(browser, { sidePanel: { open } });
    vi.spyOn(window, "close").mockImplementation(() => {});
    vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 1, windowId: 7 }] as never);
    const older = {
      draftSessionId: "older",
      draftCreatedAt: 100,
      activeTab: "improve" as const,
      original: "Current ordinary prompt",
      improved: "",
      changes: [],
      goal: "general" as const,
      lastRequestId: null,
      lastRequestContextKey: null,
      lastModel: null,
      lastLatencyMs: null,
      attemptN: 0,
    };
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      audience_mode: "ai",
      library: [],
      optimizer_draft_newer: {
        ...older,
        draftSessionId: "newer",
        draftCreatedAt: 200,
        original: "Other session",
        updatedAt: Date.now(),
      },
    });
    await act(async () => root.render(<App initialDraft={older} />));
    await flushEffects();
    await act(async () =>
      (container.querySelector(".layout-toggle-btn") as HTMLButtonElement).click(),
    );
    const handoff = vi
      .mocked(browser.storage.local.set)
      .mock.calls.flatMap(([data]) => Object.entries(data))
      .find(([key]) => key.startsWith("optimizer_panel_handoff_7_"))?.[1];
    expect(handoff).toMatchObject({
      draft: {
        draftSessionId: "older",
        original: "Current ordinary prompt",
        sourceTabId: undefined,
        sourceSessionId: undefined,
      },
    });
  });

  it("blocks oversized pastes and allows exactly 30000 Unicode characters", async () => {
    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    await setOriginalPrompt(container, "x".repeat(1000000));
    expect(container.querySelector(".prompt-length-counter")?.textContent).toBe(
      "1 000 000 / 30 000",
    );
    expect(getImproveButton(container).disabled).toBe(true);
    await setOriginalPrompt(container, "x".repeat(30001));
    expect(container.querySelector(".prompt-length-counter")?.textContent).toBe("30 001 / 30 000");
    expect(container.querySelector("textarea")?.getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain("Shorten it or split it into parts");
    expect(getImproveButton(container).disabled).toBe(true);
    await act(async () => {
      getImproveButton(container).click();
    });
    expect(
      vi
        .mocked(browser.runtime.sendMessage)
        .mock.calls.filter(([msg]) => (msg as { type?: string }).type === "IMPROVE_REQUEST"),
    ).toHaveLength(0);
    await setOriginalPrompt(container, "😀".repeat(30000));
    expect(container.querySelector(".prompt-length-counter")?.textContent).toBe("30 000 / 30 000");
    expect(getImproveButton(container).disabled).toBe(false);
    await act(async () => {
      getImproveButton(container).click();
    });
    expect(vi.mocked(browser.runtime.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ type: "IMPROVE_REQUEST" }),
    );
  });

  it("uses the configured backend limit", async () => {
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) =>
      (msg as { type?: string }).type === "GET_PROMPT_LIMIT"
        ? { max_chars: 12, fallback: false }
        : { ok: true },
    );
    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    await setOriginalPrompt(container, "x".repeat(13));
    expect(container.querySelector(".prompt-length-counter")?.textContent).toBe("13 / 12");
    expect(getImproveButton(container).disabled).toBe(true);
  });

  it.each([
    new ApiError(422, "Input text exceeds maximum length of 10 characters."),
    new Error("API 422: Input text exceeds maximum length of 10 characters."),
  ])("explains backend length rejection and updates the limit: %s", async (error) => {
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) => {
      if ((msg as { type?: string }).type === "IMPROVE_REQUEST") throw error;
      return { ok: true };
    });
    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    await setOriginalPrompt(container, "x".repeat(11));
    await act(async () => {
      getImproveButton(container).click();
    });
    expect(container.textContent).toContain("Shorten it or split it into parts");
    expect(getImproveButton(container).disabled).toBe(true);
    await setOriginalPrompt(container, "x".repeat(10));
    expect(getImproveButton(container).disabled).toBe(false);
    expect(container.textContent).not.toContain("Shorten it or split it into parts");
  });

  it("refreshes the limit in an existing side panel after activation", async () => {
    let limit = 8000;
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) =>
      (msg as { type?: string }).type === "GET_PROMPT_LIMIT"
        ? { max_chars: limit, fallback: false }
        : { ok: true },
    );
    await act(async () => {
      root.render(<App viewMode="sidepanel" />);
    });
    await flushEffects();
    await setOriginalPrompt(container, "x".repeat(9000));
    expect(getImproveButton(container).disabled).toBe(true);
    limit = 30000;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(container.querySelector(".prompt-length-counter")?.textContent).toBe("9 000 / 30 000");
    expect(getImproveButton(container).disabled).toBe(false);
    limit = 8000;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(getImproveButton(container).disabled).toBe(true);
  });

  it("blocks saving an oversized original after improving a short prompt", async () => {
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) =>
      (msg as { type?: string }).type === "IMPROVE_REQUEST"
        ? {
            type: "IMPROVE_RESULT",
            payload: { request_id: "r", improved_text: "Better prompt" },
          }
        : { ok: true },
    );
    const saveSpy = vi.spyOn(apiClient, "savePrompt").mockResolvedValue({ prompt_id: "p" });
    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    await setOriginalPrompt(container, "Short prompt");
    await act(async () => {
      getImproveButton(container).click();
    });
    await setOriginalPrompt(container, "x".repeat(30001));
    expect(findButton(container, "Save to Library").disabled).toBe(true);
    expect(findButton(container, "Copy").disabled).toBe(false);
    await act(async () => {
      findButton(container, "Save to Library").click();
    });
    expect(saveSpy).not.toHaveBeenCalled();
    await setOriginalPrompt(container, "x".repeat(30000));
    expect(findButton(container, "Save to Library").disabled).toBe(false);
    await act(async () => {
      findButton(container, "Save to Library").click();
    });
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    { field: "original_text", counter: "11 / 10", disabled: true },
    { field: "improved_text", counter: "11 / 30 000", disabled: false },
  ])(
    "handles a save-length rejection for $field without confusing input and output limits",
    async ({ field, counter, disabled }) => {
      vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) => {
        if ((msg as { type?: string }).type === "GET_PROMPT_LIMIT")
          return { max_chars: 30000, fallback: true };
        if ((msg as { type?: string }).type === "IMPROVE_REQUEST")
          return {
            type: "IMPROVE_RESULT",
            payload: { request_id: "r", improved_text: "Better prompt" },
          };
        return { ok: true };
      });
      const detail = `${field} exceeds maximum length of 10 characters.`;
      const saveSpy = vi
        .spyOn(apiClient, "savePrompt")
        .mockRejectedValueOnce(new ApiError(422, detail));
      await act(async () => {
        root.render(<App />);
      });
      await flushEffects();
      await setOriginalPrompt(container, "x".repeat(11));
      await act(async () => {
        getImproveButton(container).click();
      });
      await act(async () => {
        findButton(container, "Save to Library").click();
      });
      expect(container.querySelector(".prompt-length-counter")?.textContent).toBe(counter);
      expect(findButton(container, "Save to Library").disabled).toBe(disabled);
      expect(findButton(container, "Copy").disabled).toBe(false);
      expect(container.textContent).not.toContain("Saved!");
      if (field === "original_text") {
        expect(container.textContent).toContain("Shorten it or split it into parts");
        expect(getImproveButton(container).disabled).toBe(true);
        await act(async () => {
          window.dispatchEvent(new Event("focus"));
        });
        expect(container.querySelector(".prompt-length-counter")?.textContent).toBe("11 / 10");
        expect(findButton(container, "Save to Library").disabled).toBe(true);
        await act(async () => {
          findButton(container, "Save to Library").click();
        });
        expect(saveSpy).toHaveBeenCalledTimes(1);
        await setOriginalPrompt(container, "x".repeat(10));
        expect(findButton(container, "Save to Library").disabled).toBe(false);
        expect(container.textContent).not.toContain("Shorten it or split it into parts");
      } else {
        expect(container.textContent).toContain(detail);
        expect(container.textContent).not.toContain("Shorten it or split it into parts");
        expect(getImproveButton(container).disabled).toBe(false);
      }
    },
  );

  it("keeps an authoritative limit on fallback refresh but applies later successful configuration", async () => {
    let limitResponse = { max_chars: 10, fallback: false };
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) =>
      (msg as { type?: string }).type === "GET_PROMPT_LIMIT" ? limitResponse : { ok: true },
    );
    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    await setOriginalPrompt(container, "x".repeat(11));
    expect(getImproveButton(container).disabled).toBe(true);
    limitResponse = { max_chars: 30000, fallback: true };
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(container.querySelector(".prompt-length-counter")?.textContent).toBe("11 / 10");
    expect(getImproveButton(container).disabled).toBe(true);
    limitResponse = { max_chars: 30000, fallback: false };
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(container.querySelector(".prompt-length-counter")?.textContent).toBe("11 / 30 000");
    expect(getImproveButton(container).disabled).toBe(false);
  });

  it("uses a fallback limit when a new popup has no authoritative value", async () => {
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) =>
      (msg as { type?: string }).type === "GET_PROMPT_LIMIT"
        ? { max_chars: 12, fallback: true }
        : { ok: true },
    );
    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    await setOriginalPrompt(container, "x".repeat(13));
    expect(container.querySelector(".prompt-length-counter")?.textContent).toBe("13 / 12");
    expect(getImproveButton(container).disabled).toBe(true);
  });

  it("does not apply a successful config response that predates a 422", async () => {
    let resolveOld!: (value: unknown) => void;
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) => {
      if ((msg as { type?: string }).type === "GET_PROMPT_LIMIT")
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      if ((msg as { type?: string }).type === "IMPROVE_REQUEST")
        throw new ApiError(422, "Input text exceeds maximum length of 8000 characters.");
      return { ok: true };
    });
    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    await setOriginalPrompt(container, "x".repeat(9000));
    await act(async () => {
      getImproveButton(container).click();
    });
    expect(container.querySelector(".prompt-length-counter")?.textContent).toBe("9 000 / 8 000");
    await act(async () => {
      resolveOld({ max_chars: 30000, fallback: false });
    });
    expect(container.querySelector(".prompt-length-counter")?.textContent).toBe("9 000 / 8 000");
    expect(getImproveButton(container).disabled).toBe(true);
  });

  it("revalidates a restored result before saving while the initial config is pending", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      installation_id: "i",
      audience_mode: "ai",
      library: [],
      popup_session_draft: {
        activeTab: "improve",
        original: "x".repeat(9000),
        improved: "Better prompt",
        changes: [],
        goal: "general",
        lastRequestId: "r",
        lastRequestContextKey: null,
        lastModel: null,
        lastLatencyMs: null,
        attemptN: 1,
        updatedAt: Date.now(),
      },
    });
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) =>
      (msg as { type?: string }).type === "GET_PROMPT_LIMIT" ? new Promise(() => {}) : { ok: true },
    );
    let resolveConfig!: (value: unknown) => void;
    global.fetch = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveConfig = resolve;
      }),
    );
    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    await act(async () => {
      findButton(container, "Save to Library").click();
    });
    const callsBefore = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    await act(async () => {
      resolveConfig({ ok: true, json: async () => ({ prompt_input_max_chars: 8000 }) });
    });
    expect(callsBefore).toEqual(["https://api.anytoolai.store/v1/config"]);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/v1/prompts"))).toBe(
      false,
    );
    expect(container.querySelector(".prompt-length-counter")?.textContent).toBe("9 000 / 8 000");
    expect(findButton(container, "Save to Library").disabled).toBe(true);
  });

  it("handles a local quota failure without sending or duplicating a remote save", async () => {
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) =>
      (msg as { type?: string }).type === "IMPROVE_REQUEST"
        ? { type: "IMPROVE_RESULT", payload: { request_id: "r", improved_text: "Better prompt" } }
        : { ok: true },
    );
    const remote = vi.spyOn(apiClient, "savePrompt").mockResolvedValue({ prompt_id: "p" });
    vi.mocked(browser.storage.local.set).mockImplementation(async (data) => {
      if ("library" in data || "pending_library_saves" in data) throw new Error("QUOTA_BYTES");
    });
    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    await setOriginalPrompt(container, "short");
    await act(async () => {
      getImproveButton(container).click();
    });
    await act(async () => {
      findButton(container, "Save to Library").click();
    });
    expect(container.textContent).toContain("Could not save the prompt on this device");
    expect(container.textContent).not.toContain("Saved!");
    await act(async () => {
      findButton(container, "Save to Library").click();
    });
    expect(remote).not.toHaveBeenCalled();
  });

  it("allows improve requests after a limits lookup failure", async () => {
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) => {
      const typed = msg as { type?: string };
      if (typed.type === "GET_LIMITS") throw new Error("limits lookup failed");
      if (typed.type === "IMPROVE_REQUEST") {
        return {
          type: "IMPROVE_RESULT",
          payload: {
            request_id: "req-1",
            improved_text: "Improved prompt",
            changes: [
              "Clarified the user goal and output format.",
              "Added constraints to reduce ambiguity.",
              "Specified concrete success criteria for the answer.",
            ],
          },
        };
      }
      return { ok: true };
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    await setOriginalPrompt(container, "Original prompt");
    expect(getImproveButton(container).disabled).toBe(false);

    await act(async () => {
      getImproveButton(container).click();
      await Promise.resolve();
    });
    await flushEffects();

    expect(vi.mocked(browser.runtime.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "IMPROVE_REQUEST",
      }),
    );

    const improvedField = container.querySelector(".improved-textarea");
    expect(improvedField).toBeInstanceOf(HTMLTextAreaElement);
    expect((improvedField as HTMLTextAreaElement).value).toBe("Improved prompt");
    expect(container.textContent).toContain("Why it changed");
    expect(container.textContent).toContain("Clarified the user goal and output format.");
    expect(container.textContent).toContain("Limits unavailable");
    expect(container.textContent).not.toContain("You've used all free improvements today.");

    const details = container.querySelector(".improvements-details");
    expect(details).toBeInstanceOf(HTMLDetailsElement);
    expect((details as HTMLDetailsElement).open).toBe(false);

    await act(async () => {
      const el = details as HTMLDetailsElement;
      el.open = true;
      el.dispatchEvent(new Event("toggle"));
    });
    await flushEffects();

    await setOriginalPrompt(container, "Original prompt edited");
    const detailsRequeried = container.querySelector(".improvements-details");
    expect(detailsRequeried).toBeInstanceOf(HTMLDetailsElement);
    expect((detailsRequeried as HTMLDetailsElement).open).toBe(true);
  });

  it("tracks upgrade intent and shows coming soon without external navigation", async () => {
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) => {
      const typed = msg as { type?: string };
      if (typed.type === "GET_LIMITS") {
        return {
          type: "LIMITS_RESULT",
          payload: {
            rate_limit: {
              per_minute_remaining: 0,
              per_day_remaining: 0,
              per_minute_total: 5,
              per_day_total: 10,
            },
          },
        };
      }
      return { ok: true };
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    expect(container.textContent).toContain("You've used all free improvements today.");
    expect(container.textContent).toContain("Upgrade for unlimited");

    await act(async () => {
      findButton(container, "Upgrade for unlimited").click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Pro soon");
    expect(browser.tabs.create).not.toHaveBeenCalled();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: "TRACK_EVENT",
      payload: {
        name: "upgrade_clicked",
        properties: {
          surface: "rate_limit_banner",
          destination: "coming_soon",
          email_collected: false,
          paid_checkout_enabled: false,
        },
        context: { source: "popup" },
      },
    });
  });

  it("tracks upgrade intent and shows coming soon from the rate-limit tooltip", async () => {
    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    const limitBadge = container.querySelector(".rate-limit-badge");
    expect(limitBadge).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      (limitBadge as HTMLButtonElement).focus();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("improvements left today");
    expect(container.querySelector(".rate-limit-tooltip")?.textContent).toContain(
      "Upgrade for unlimited",
    );
    expect(findButton(container, "Upgrade for unlimited").className).toBe(
      "rate-limit-tooltip-link",
    );

    await act(async () => {
      findButton(container, "Upgrade for unlimited").click();
      await Promise.resolve();
    });

    expect(container.querySelector(".rate-limit-tooltip")?.textContent).toContain("Pro soon");
    expect(browser.tabs.create).not.toHaveBeenCalled();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: "TRACK_EVENT",
      payload: {
        name: "upgrade_clicked",
        properties: {
          surface: "rate_limit_tooltip",
          destination: "coming_soon",
          email_collected: false,
          paid_checkout_enabled: false,
        },
        context: { source: "popup" },
      },
    });
  });

  it.each([4, 5])("routes a %i-star rating to the Chrome Web Store review page", async (star) => {
    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    const highRatingStar = container.querySelector(`[aria-label="Rate ${star} stars"]`);
    expect(highRatingStar).toBeInstanceOf(HTMLElement);

    await act(async () => {
      (highRatingStar as HTMLElement).click();
      await Promise.resolve();
    });

    expect(browser.tabs.create).toHaveBeenCalledWith({
      url: "https://chromewebstore.google.com/detail/prompt-optimizer-%E2%80%93-improv/fbageijibmjblopdbgpdcpkojhnjjbpe/reviews",
    });
  });

  it.each([1, 2, 3])("routes a %i-star rating to the product feedback form", async (star) => {
    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    const lowRatingStar = container.querySelector(
      `[aria-label="Rate ${star} star${star > 1 ? "s" : ""}"]`,
    );
    expect(lowRatingStar).toBeInstanceOf(HTMLElement);

    await act(async () => {
      (lowRatingStar as HTMLElement).click();
      await Promise.resolve();
    });

    expect(browser.tabs.create).toHaveBeenCalledWith({
      url: expect.stringContaining("https://docs.google.com/forms/d/e/"),
    });
  });

  it("does not show a saved state when the save request fails", async () => {
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) => {
      const typed = msg as { type?: string };
      if (typed.type === "GET_LIMITS") {
        return {
          type: "LIMITS_RESULT",
          payload: {
            rate_limit: {
              per_minute_remaining: 4,
              per_day_remaining: 10,
              per_minute_total: 5,
              per_day_total: 10,
            },
          },
        };
      }
      if (typed.type === "IMPROVE_REQUEST") {
        return {
          type: "IMPROVE_RESULT",
          payload: {
            request_id: "req-2",
            improved_text: "Improved prompt",
          },
        };
      }
      return { ok: true };
    });

    const savePromptSpy = vi
      .spyOn(apiClient, "savePrompt")
      .mockRejectedValue(new ApiError(429, "rate limit exceeded"));

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    await setOriginalPrompt(container, "Original prompt");
    expect(getImproveButton(container).disabled).toBe(false);

    await act(async () => {
      getImproveButton(container).click();
      await Promise.resolve();
    });
    await flushEffects();
    expect(findButton(container, "Save to Library").disabled).toBe(false);

    await act(async () => {
      findButton(container, "Save to Library").click();
      await Promise.resolve();
    });
    await flushEffects();

    expect(savePromptSpy).toHaveBeenCalledTimes(1);
    expect(findButton(container, "Save").textContent).toContain("Save to Library");
    expect(container.textContent).not.toContain("Saved!");
    expect(container.textContent).toContain(
      "You've used all 10 requests today. Resets at midnight UTC.",
    );
    const libraryWrites = vi
      .mocked(browser.storage.local.set)
      .mock.calls.filter(([data]) => "library" in data);
    expect(libraryWrites).toHaveLength(0);
    expect(browser.storage.local.set).toHaveBeenCalledWith({ pending_library_saves: [] });
  });

  it("sends selected mode and goal in improve requests", async () => {
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) => {
      const typed = msg as { type?: string; payload?: Record<string, unknown> };
      if (typed.type === "GET_LIMITS") {
        return {
          type: "LIMITS_RESULT",
          payload: {
            rate_limit: {
              per_minute_remaining: 4,
              per_day_remaining: 10,
              per_minute_total: 5,
              per_day_total: 10,
            },
          },
        };
      }
      if (typed.type === "IMPROVE_REQUEST") {
        return {
          type: "IMPROVE_RESULT",
          payload: {
            request_id: "req-3",
            improved_text: "Improved for SEO",
          },
        };
      }
      return { ok: true };
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    await setOriginalPrompt(container, "Original prompt");
    await selectMode(container, "content");
    await flushEffects();
    await act(async () => {
      selectGoal(container, "seo_article");
    });

    await act(async () => {
      getImproveButton(container).click();
      await Promise.resolve();
    });
    await flushEffects();

    expect(vi.mocked(browser.runtime.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "IMPROVE_REQUEST",
        payload: expect.objectContaining({
          text: "Original prompt",
          audience_mode: "content",
          goal: "seo_article",
        }),
      }),
    );
  });

  it("inserts improved text into the active tab", async () => {
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ success: true });
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) => {
      const typed = msg as { type?: string };
      if (typed.type === "GET_LIMITS") {
        return {
          type: "LIMITS_RESULT",
          payload: {
            rate_limit: {
              per_minute_remaining: 4,
              per_day_remaining: 10,
              per_minute_total: 5,
              per_day_total: 10,
            },
          },
        };
      }
      if (typed.type === "IMPROVE_REQUEST") {
        return {
          type: "IMPROVE_RESULT",
          payload: {
            request_id: "req-4",
            improved_text: "Improved prompt",
          },
        };
      }
      return { ok: true };
    });
    vi.mocked(browser.tabs.query)
      .mockResolvedValueOnce([{ id: 777, url: "https://chatgpt.com/" }] as never)
      .mockResolvedValueOnce([{ id: 123 }] as never);

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    await setOriginalPrompt(container, "Original prompt");
    await act(async () => {
      getImproveButton(container).click();
      await Promise.resolve();
    });
    await flushEffects();

    await act(async () => {
      findButton(container, "Insert").click();
      await Promise.resolve();
    });
    await flushEffects();

    expect(vi.mocked(browser.tabs.query)).toHaveBeenLastCalledWith({
      active: true,
      currentWindow: true,
    });
    expect(vi.mocked(browser.tabs.sendMessage)).toHaveBeenCalledWith(123, {
      type: "PASTE_TEXT",
      payload: { text: "Improved prompt" },
    });
    expect(container.textContent).toContain("Inserted!");
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "TRACK_EVENT",
        payload: expect.objectContaining({ name: "result_copied" }),
      }),
    );
  });

  it("auto-detects AI goal from active tab hostname", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 77, url: "https://claude.ai/new" },
    ] as never);
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) => {
      const typed = msg as { type?: string };
      if (typed.type === "GET_LIMITS") {
        return {
          type: "LIMITS_RESULT",
          payload: {
            rate_limit: {
              per_minute_remaining: 4,
              per_day_remaining: 10,
              per_minute_total: 5,
              per_day_total: 10,
            },
          },
        };
      }
      if (typed.type === "IMPROVE_REQUEST") {
        return {
          type: "IMPROVE_RESULT",
          payload: {
            request_id: "req-5",
            improved_text: "Improved for Claude",
          },
        };
      }
      return { ok: true };
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    await setOriginalPrompt(container, "Original prompt");
    await act(async () => {
      getImproveButton(container).click();
      await Promise.resolve();
    });
    await flushEffects();

    expect(vi.mocked(browser.runtime.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "IMPROVE_REQUEST",
        payload: expect.objectContaining({
          text: "Original prompt",
          audience_mode: "ai",
          goal: "claude",
        }),
      }),
    );
  });

  it("refreshes active tab context while rendered as a side panel", async () => {
    vi.mocked(browser.tabs.query)
      .mockResolvedValueOnce([{ id: 77, url: "https://chatgpt.com/" }] as never)
      .mockResolvedValueOnce([{ id: 88, url: "https://claude.ai/new" }] as never);
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) => {
      const typed = msg as { type?: string };
      if (typed.type === "GET_LIMITS") {
        return {
          type: "LIMITS_RESULT",
          payload: {
            rate_limit: {
              per_minute_remaining: 4,
              per_day_remaining: 10,
              per_minute_total: 5,
              per_day_total: 10,
            },
          },
        };
      }
      if (typed.type === "IMPROVE_REQUEST") {
        return {
          type: "IMPROVE_RESULT",
          payload: {
            request_id: "req-6",
            improved_text: "Improved for current tab",
          },
        };
      }
      return { ok: true };
    });

    await act(async () => {
      root.render(<App viewMode="sidepanel" />);
    });
    await flushEffects();

    const activationListener = vi.mocked(browser.tabs.onActivated.addListener).mock.calls[0]?.[0];
    expect(activationListener).toBeTypeOf("function");

    await act(async () => {
      activationListener({ tabId: 88, windowId: 1 });
      await Promise.resolve();
    });
    await flushEffects();

    await setOriginalPrompt(container, "Original prompt");
    await act(async () => {
      getImproveButton(container).click();
      await Promise.resolve();
    });
    await flushEffects();

    expect(vi.mocked(browser.runtime.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "IMPROVE_REQUEST",
        payload: expect.objectContaining({
          text: "Original prompt",
          audience_mode: "ai",
          goal: "claude",
          site: "claude.ai",
        }),
      }),
    );
  });

  it("shows onboarding and persists selected mode when missing", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      installation_id: "install-1",
      library: [],
    });
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      type: "LIMITS_RESULT",
      payload: {
        rate_limit: {
          per_minute_remaining: 4,
          per_day_remaining: 10,
          per_minute_total: 5,
          per_day_total: 10,
        },
      },
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    expect(container.textContent).toContain("Choose mode to continue");
    await selectMode(container, "ai");
    await flushEffects();

    expect(browser.storage.local.set).toHaveBeenCalledWith({ audience_mode: "ai" });
    expect(container.textContent).toContain("AI Mode");
  });

  it("does not restore an expired popup session draft", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      installation_id: "install-1",
      library: [],
      audience_mode: "ai",
      popup_session_draft: {
        activeTab: "improve",
        original: "Old original",
        improved: "Old improved",
        changes: [],
        goal: "general",
        lastRequestId: null,
        lastRequestContextKey: null,
        lastModel: null,
        lastLatencyMs: null,
        attemptN: 1,
        updatedAt: new Date("2026-06-16T12:00:00.000Z").getTime() - LIMITS.POPUP_SESSION_TTL_MS - 1,
      },
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();

    const originalField = container.querySelector("textarea");
    expect(originalField).toBeInstanceOf(HTMLTextAreaElement);
    expect((originalField as HTMLTextAreaElement).value).toBe("");
    expect(container.textContent).not.toContain("Old improved");
    expect(vi.mocked(browser.storage.local.remove)).toHaveBeenCalledWith("popup_session_draft");
  });
});
