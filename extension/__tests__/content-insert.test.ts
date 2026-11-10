// @vitest-environment-options {"url":"https://chatgpt.com/settings"}
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
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

it.each(["text", "search"])(
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

it.each(["textarea", "input"])(
  "updates a React-controlled %s and survives re-render",
  async (tag) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const changed = vi.fn();
    function Composer({ revision }: { revision: number }) {
      const [value, setValue] = useState("Before insertion");
      return createElement(tag, {
        value,
        "data-revision": revision,
        onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          changed(event.target.value);
          setValue(event.target.value);
        },
      });
    }
    try {
      await act(async () => {
        root.render(createElement(Composer, { revision: 0 }));
      });
      const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(tag)!;
      field.focus();
      let response;
      await act(async () => {
        response = await handle({ type: "PASTE_TEXT", payload: { text: "New prompt" } });
      });
      expect(response).toEqual({ success: true });
      expect(changed).toHaveBeenCalledWith("New prompt");
      await act(async () => {
        root.render(createElement(Composer, { revision: 1 }));
      });
      expect(field.value).toBe("New prompt");
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  },
);

it("rejects insertion when the editor restores its previous text", async () => {
  const field = document.createElement("textarea");
  field.value = "Previous";
  field.addEventListener("input", () => {
    field.value = "Previous";
  });
  document.body.append(field);
  field.focus();
  expect(await handle({ type: "PASTE_TEXT", payload: { text: "New prompt" } })).toEqual({
    success: false,
  });
});

it("does not acknowledge a React-controlled composer that rejects the change", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Composer() {
    return createElement("textarea", { value: "Previous", onChange: () => {} });
  }
  try {
    await act(async () => {
      root.render(createElement(Composer));
    });
    const field = host.querySelector("textarea")!;
    field.focus();
    let response;
    await act(async () => {
      response = await handle({ type: "PASTE_TEXT", payload: { text: "New prompt" } });
    });
    expect(response).toEqual({ success: false });
    expect(field.value).toBe("Previous");
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

it.each(["password", "email", "tel", "url"])(
  "preserves a focused %s field when the supported site has no composer",
  async (type) => {
    expect(location.hostname).toBe("chatgpt.com");
    expect(document.querySelector("#prompt-textarea")).toBeNull();
    const field = document.createElement("input");
    field.type = type;
    field.value = "existing-value";
    document.body.append(field);
    field.focus();
    expect(await handle({ type: "PASTE_TEXT", payload: { text: "New prompt" } })).toEqual({
      success: false,
    });
    expect(field.value).toBe("existing-value");
  },
);
