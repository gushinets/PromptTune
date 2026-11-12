import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { App } from "../entrypoints/popup/App";

let state: Record<string, unknown>;
const roots = new Set<Root>();
const hosts: HTMLElement[] = [];
beforeEach(() => {
  vi.clearAllMocks();
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
    expect(reloadedSelection.host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
      "Selection B",
    );
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
