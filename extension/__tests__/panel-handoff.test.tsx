import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { SidepanelApp } from "../entrypoints/sidepanel/SidepanelApp";

let host: HTMLDivElement;
let root: Root;
const selected = {
  id: "selection-session",
  expiresAt: Date.now() + 300000,
  draft: {
    sourceTabId: 42,
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
  vi.mocked(browser.storage.local.get).mockImplementation(async (key) => {
    if (key === null)
      return new Promise((resolve) => {
        finishRead = resolve;
      });
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
