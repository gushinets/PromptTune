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

function selectGoal(container: HTMLElement, goal: string) {
  const radio = container.querySelector(`input[type="radio"][value="${goal}"]`);
  if (!(radio instanceof HTMLInputElement)) {
    throw new Error(`Goal radio not found: ${goal}`);
  }

  radio.click();
}

async function selectMode(container: HTMLElement, mode: "ai" | "content") {
  const settingsTrigger = container.querySelector('[data-testid="mode-switch-trigger"]');

  if (!(settingsTrigger instanceof HTMLButtonElement)) {
    const onboardingTarget = container.querySelector(`.mode-onboarding-card[data-mode="${mode}"]`);
    if (!(onboardingTarget instanceof HTMLButtonElement)) {
      throw new Error(`Onboarding mode card not found: ${mode}`);
    }

    await act(async () => {
      onboardingTarget.click();
      await Promise.resolve();
    });
    return;
  }

  await act(async () => {
    settingsTrigger.click();
    await Promise.resolve();
  });

  const target = container.querySelector(
    `.settings-popover .settings-mode-card[data-mode="${mode}"]`,
  );
  if (!(target instanceof HTMLButtonElement)) {
    throw new Error(`Mode card not found: ${mode}`);
  }

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
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      installation_id: "install-1",
      library: [],
      audience_mode: "ai",
    });
    vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
    vi.mocked(browser.runtime.getManifest).mockReturnValue({
      version: "0.1.0",
    } as ReturnType<typeof browser.runtime.getManifest>);
    vi.mocked(browser.tabs.query).mockResolvedValue([] as never);
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
    expect(vi.mocked(browser.storage.local.set)).not.toHaveBeenCalledWith(
      expect.objectContaining({ library: expect.anything() }),
    );
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
    await act(async () => {
      await selectMode(container, "content");
    });
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
});
