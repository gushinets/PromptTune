import { afterEach, beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import type { Message } from "@shared/messages";

let handle: (message: Message) => Promise<unknown>;
let focusListener: EventListener;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("defineContentScript", (script: unknown) => script);
  const listeners = vi.spyOn(document, "addEventListener");
  const { default: script } = await import("../entrypoints/content/index");
  (script as unknown as { main: () => void }).main();
  focusListener = listeners.mock.calls.find(([type]) => type === "focusin")![1] as EventListener;
  handle = vi
    .mocked(browser.runtime.onMessage.addListener)
    .mock.calls.at(-1)![0] as unknown as typeof handle;
});

afterEach(() => {
  document.removeEventListener("focusin", focusListener);
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["textarea", "div"])("rejects a detached previously focused %s", async (tag) => {
  const field = document.createElement(tag);
  field.setAttribute("contenteditable", "true");
  field.tabIndex = 0;
  document.body.append(field);
  field.focus();
  field.remove();
  expect(await handle({ type: "PASTE_TEXT", payload: { text: "New prompt" } })).toEqual({
    success: false,
  });
  expect(field instanceof HTMLTextAreaElement ? field.value : field.innerText).not.toBe(
    "New prompt",
  );
});

it.each(["readOnly", "disabled"] as const)(
  "rejects a composer that became %s",
  async (property) => {
    const field = document.createElement("textarea");
    document.body.append(field);
    field.focus();
    field[property] = true;
    expect(await handle({ type: "PASTE_TEXT", payload: { text: "New prompt" } })).toEqual({
      success: false,
    });
    expect(field.value).toBe("");
  },
);

it.each(["checkbox", "radio", "range", "number", "date", "file", "button"])(
  "rejects a focused non-text input of type %s",
  async (type) => {
    const field = document.createElement("input");
    field.type = type;
    document.body.append(field);
    field.focus();
    const original = field.value;
    expect(await handle({ type: "PASTE_TEXT", payload: { text: "New prompt" } })).toEqual({
      success: false,
    });
    expect(field.value).toBe(original);
  },
);

it.each(["text", "search", "tel", "url", "email", "password"])(
  "acknowledges insertion into a live text input of type %s",
  async (type) => {
    const field = document.createElement("input");
    field.type = type;
    document.body.append(field);
    field.focus();
    expect(await handle({ type: "PASTE_TEXT", payload: { text: "New prompt" } })).toEqual({
      success: true,
    });
    expect(field.value).toBe("New prompt");
  },
);

it("acknowledges insertion into a live editable composer", async () => {
  const field = document.createElement("textarea");
  document.body.append(field);
  field.focus();
  expect(await handle({ type: "PASTE_TEXT", payload: { text: "New prompt" } })).toEqual({
    success: true,
  });
  expect(field.value).toBe("New prompt");
});
