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
