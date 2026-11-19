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

it.each([0, 1])(
  "opens quota UI for a final hotkey result only without pending work (%i pending)",
  async (pending) => {
    const field = document.createElement("textarea");
    field.id = "prompt-textarea";
    field.value = "Original";
    document.body.append(field);
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
      if ((message as { type?: string }).type === "IMPROVE_REQUEST")
        return {
          request_id: "last",
          improved_text: "Inserted last result",
          rate_limit: {
            remaining: 0,
            total: 50,
            pending_improvements: pending,
            exhausted: pending === 0,
            bonus_claimed: false,
            per_day_remaining: 0,
            per_day_total: 50,
            per_minute_remaining: 9,
            per_minute_total: 10,
          },
        };
      return { ok: true };
    });
    await handle({ type: "IMPROVE_ACTIVE_FIELD" });
    expect(field.value).toBe("Inserted last result");
    const call = expect.objectContaining({ type: "SHOW_QUOTA" });
    if (pending === 0) expect(browser.runtime.sendMessage).toHaveBeenCalledWith(call);
    else expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(call);
  },
);

it("routes an exhausted hotkey attempt to quota UI without changing the field", async () => {
  const field = document.createElement("textarea");
  field.id = "prompt-textarea";
  field.value = "Existing result";
  document.body.append(field);
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
    if ((message as { type?: string }).type === "IMPROVE_REQUEST")
      throw new Error("API 429: Monthly improvement quota exhausted");
    return { ok: true };
  });
  await handle({ type: "IMPROVE_ACTIVE_FIELD" });
  expect(field.value).toBe("Existing result");
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "SHOW_QUOTA" }),
  );
});
