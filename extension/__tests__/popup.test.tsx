import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { ApiError, apiClient } from "@shared/api-client";
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
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      installation_id: "install-1",
      library: [],
    });
    vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
    vi.mocked(browser.runtime.getManifest).mockReturnValue({
      version: "0.1.0",
    } as ReturnType<typeof browser.runtime.getManifest>);

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
  });

  it("allows improve requests after a limits lookup failure", async () => {
    vi.mocked(browser.runtime.sendMessage)
      .mockRejectedValueOnce(new Error("limits lookup failed"))
      .mockResolvedValueOnce({
        type: "IMPROVE_RESULT",
        payload: {
          request_id: "req-1",
          improved_text: "Improved prompt",
        },
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

    expect(vi.mocked(browser.runtime.sendMessage)).toHaveBeenNthCalledWith(2, {
      type: "IMPROVE_REQUEST",
      payload: { text: "Original prompt" },
    });

    const improvedField = container.querySelector(".improved-textarea");
    expect(improvedField).toBeInstanceOf(HTMLTextAreaElement);
    expect((improvedField as HTMLTextAreaElement).value).toBe("Improved prompt");
    expect(container.textContent).toContain("Limits unavailable");
    expect(container.textContent).not.toContain("You've used all free improvements today.");
  });

  it("does not show a saved state when the save request fails", async () => {
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({
        type: "LIMITS_RESULT",
        payload: {
          rate_limit: {
            per_minute_remaining: 4,
            per_day_remaining: 10,
            per_minute_total: 5,
            per_day_total: 10,
          },
        },
      })
      .mockResolvedValueOnce({
        type: "IMPROVE_RESULT",
        payload: {
          request_id: "req-2",
          improved_text: "Improved prompt",
        },
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
    expect(vi.mocked(browser.storage.local.set)).not.toHaveBeenCalled();
  });

  it("inserts improved text into the active tab", async () => {
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({
        type: "LIMITS_RESULT",
        payload: {
          rate_limit: {
            per_minute_remaining: 4,
            per_day_remaining: 10,
            per_minute_total: 5,
            per_day_total: 10,
          },
        },
      })
      .mockResolvedValueOnce({
        type: "IMPROVE_RESULT",
        payload: {
          request_id: "req-3",
          improved_text: "Improved prompt",
        },
      });
    vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 123 }] as never);

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

    expect(vi.mocked(browser.tabs.query)).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });
    expect(vi.mocked(browser.tabs.sendMessage)).toHaveBeenCalledWith(123, {
      type: "PASTE_TEXT",
      payload: { text: "Improved prompt" },
    });
  });
});
