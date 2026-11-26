import { afterEach, beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import type { Message } from "@shared/messages";
import type { ImproveGoal } from "@shared/types";

vi.mock("@shared/analytics", () => ({ trackEvent: vi.fn() }));

let focusListener: EventListener;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("defineContentScript", (script: unknown) => script);
});

afterEach(() => {
  document.removeEventListener("focusin", focusListener);
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function startContentScript(hostname: string) {
  vi.stubGlobal("location", new URL(`https://${hostname}/`));
  const listeners = vi.spyOn(document, "addEventListener");
  const { default: script } = await import("../entrypoints/content/index");
  (script as unknown as { main: () => void }).main();
  focusListener = listeners.mock.calls.find(([type]) => type === "focusin")![1] as EventListener;
  const field = document.createElement("textarea");
  field.id = "prompt-textarea";
  field.value = "Original prompt";
  document.body.append(field);
  field.focus();
  const handle = vi
    .mocked(browser.runtime.onMessage.addListener)
    .mock.calls.at(-1)![0] as unknown as (message: Message) => Promise<unknown>;
  return { field, handle };
}

const hosts: [string, ImproveGoal][] = [
  ["chatgpt.com", "chatgpt"],
  ["www.chatgpt.com", "chatgpt"],
  ["a.b.chatgpt.com", "chatgpt"],
  ["CHATGPT.COM", "chatgpt"],
  ["claude.ai", "claude"],
  ["www.claude.ai", "claude"],
  ["a.b.claude.ai", "claude"],
  ["perplexity.ai", "perplexity"],
  ["www.perplexity.ai", "perplexity"],
  ["a.b.perplexity.ai", "perplexity"],
  ["fakechatgpt.com", "general"],
  ["fakeclaude.ai", "general"],
  ["fakeperplexity.ai", "general"],
  ["www.fakechatgpt.com", "general"],
  ["www.fakeclaude.ai", "general"],
  ["www.fakeperplexity.ai", "general"],
  ["chatgpt.com.example.org", "general"],
  ["claude.ai.example.org", "general"],
  ["perplexity.ai.example.org", "general"],
  ["groq.com", "general"],
  ["chat.deepseek.com", "general"],
];

it.each(hosts)("hotkey on %s sends goal %s and inserts the result", async (hostname, goal) => {
  const { field, handle } = await startContentScript(hostname);
  vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
    request_id: "hostname-test",
    improved_text: "Improved prompt",
  });
  await handle({ type: "IMPROVE_ACTIVE_FIELD" });
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
    type: "IMPROVE_REQUEST",
    payload: expect.objectContaining({ text: "Original prompt", goal, site: location.hostname }),
  });
  expect(field.value).toBe("Improved prompt");
});

it.each(hosts)("quota handoff on %s preserves goal %s", async (hostname, goal) => {
  const { field, handle } = await startContentScript(hostname);
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (raw) => {
    if ((raw as Message).type === "IMPROVE_REQUEST") {
      throw new Error("API 429: Monthly improvement quota exhausted");
    }
    return undefined;
  });
  await handle({ type: "IMPROVE_ACTIVE_FIELD" });
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
    type: "SHOW_QUOTA",
    payload: { original: "Original prompt", goal },
  });
  expect(field.value).toBe("Original prompt");
});
