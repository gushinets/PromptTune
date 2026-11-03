import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { apiClient } from "@shared/api-client";
import { N8N_WEBHOOK_URL } from "@shared/constants";
import { App } from "../entrypoints/popup/App";

vi.mock("@shared/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/constants")>()),
  BACKEND_MODE: "n8n",
  ANALYTICS_ENABLED: false,
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
const text = "x".repeat(30001);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    installation_id: "i",
    audience_mode: "ai",
    library: [],
  });
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ improved_prompt: "Improved prompt", model: "test" }),
  });
});

afterEach(async () => {
  if (root)
    await act(async () => {
      root?.unmount();
    });
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

it("sends prompts beyond FastAPI's limit directly to the n8n webhook", async () => {
  const result = await apiClient.improve({ text, installation_id: "i", client: "extension" });
  expect(result.improved_text).toBe("Improved prompt");
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    N8N_WEBHOOK_URL,
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ prompt: text }),
    }),
  );
});

it("allows oversized prompts through the background n8n path without requesting config", async () => {
  vi.stubGlobal("defineBackground", (main: () => void) => main);
  Object.assign(browser, { permissions: { onRemoved: { addListener: vi.fn() } } });
  Object.assign(browser.runtime, { onInstalled: { addListener: vi.fn() } });
  const { default: main } = await import("../entrypoints/background/index");
  (main as unknown as () => void)();
  const handle = vi
    .mocked(browser.runtime.onMessage.addListener)
    .mock.calls.at(-1)?.[0] as unknown as (msg: unknown) => Promise<unknown>;
  await expect(handle({ type: "IMPROVE_REQUEST", payload: { text } })).resolves.toMatchObject({
    type: "IMPROVE_RESULT",
    payload: { improved_text: "Improved prompt" },
  });
  expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([N8N_WEBHOOK_URL]);
});

it("allows improving and saving long inputs in n8n mode without displaying a FastAPI limit", async () => {
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) =>
    (msg as { type?: string }).type === "IMPROVE_REQUEST"
      ? {
          type: "IMPROVE_RESULT",
          payload: { request_id: "r", improved_text: "Improved prompt" },
        }
      : { ok: true },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<App />);
  });
  const field = container.querySelector("textarea") as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const improve = container.querySelector(".btn-improve") as HTMLButtonElement;
  expect(improve.disabled).toBe(false);
  expect(container.querySelector(".prompt-length-counter")).toBeNull();
  await act(async () => {
    improve.click();
  });
  const save = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Save to Library"),
  ) as HTMLButtonElement;
  expect(save.disabled).toBe(false);
  await act(async () => {
    save.click();
  });
  expect(container.textContent).toContain("Saved!");
  expect(browser.storage.local.set).toHaveBeenCalledWith(
    expect.objectContaining({
      library: [expect.objectContaining({ original: text, improved: "Improved prompt" })],
    }),
  );
  expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith({ type: "GET_PROMPT_LIMIT" });
  expect(fetch).not.toHaveBeenCalled();
});
