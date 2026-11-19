import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { App } from "../entrypoints/popup/App";

let root: Root, host: HTMLDivElement;
const quota = (remaining: number, claimed = false) => ({
  remaining,
  total: 50,
  next_reset_at: "2027-01-15T21:00:00Z",
  bonus_claimed: claimed,
  email_verified: claimed,
  per_day_remaining: remaining,
  per_day_total: 50,
  per_minute_remaining: 10,
  per_minute_total: 10,
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(browser.runtime.getManifest).mockReturnValue({ version: "0.1.0" } as ReturnType<
    typeof browser.runtime.getManifest
  >);
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    installation_id: "i",
    audience_mode: "ai",
    library: [],
  });
  vi.mocked(browser.tabs.query).mockResolvedValue([]);
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
    if ((message as { type?: string }).type === "GET_LIMITS") return quota(1);
    if ((message as { type?: string }).type === "GET_PROMPT_LIMIT")
      return { max_chars: 30000, fallback: false };
    if ((message as { type?: string }).type === "IMPROVE_REQUEST")
      return { request_id: "final", improved_text: "Last useful result", rate_limit: quota(0) };
    return { ok: true };
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function generate(viewMode: "popup" | "sidepanel" = "popup") {
  await act(async () => root.render(<App viewMode={viewMode} />));
  await act(async () => {
    const field = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      field,
      "Improve this",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLButtonElement>(".btn-improve")!.click());
}
it.each(["popup", "sidepanel"] as const)(
  "opens offer on last success and preserves result/library on %s",
  async (viewMode) => {
    await act(async () => root.render(<App viewMode={viewMode} />));
    await generate(viewMode);
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
      "Get 50 more improvements?",
    );
    await act(async () => host.querySelector<HTMLButtonElement>("[data-close]")!.click());
    expect(host.textContent).toContain("Last useful result");
    expect(
      [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Copy"))?.disabled,
    ).toBe(false);
    await act(async () =>
      [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Library"))!.click(),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  },
);
it("shows renewal date after claimed bonus and blocks only new generation", async () => {
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) =>
    (message as { type?: string }).type === "GET_LIMITS" ? quota(0, true) : { ok: true },
  );
  await act(async () => root.render(<App />));
  expect(host.querySelector(".upgrade-banner")?.textContent).toContain("2027");
  expect(host.querySelector<HTMLButtonElement>(".btn-improve")?.disabled).toBe(true);
  expect(host.textContent).not.toContain("Get 50 more improvements?");
});
it("temporary 429 does not erase monthly balance or offer bonus", async () => {
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
    if ((message as { type?: string }).type === "GET_LIMITS") return quota(12);
    if ((message as { type?: string }).type === "IMPROVE_REQUEST")
      throw new Error("API 429: Too many requests");
    return { ok: true };
  });
  await generate();
  expect(host.querySelector(".rate-limit-badge")?.textContent).toContain("12");
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it("ignores a stale balance response that arrives after a successful improvement", async () => {
  let release!: (value: unknown) => void;
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
    if ((message as { type?: string }).type === "GET_LIMITS")
      return new Promise((resolve) => {
        release = resolve;
      });
    if ((message as { type?: string }).type === "IMPROVE_REQUEST")
      return { request_id: "last", improved_text: "Last result", rate_limit: quota(0) };
    return { ok: true };
  });
  await generate();
  await act(async () => release(quota(50)));
  expect(host.querySelector('.rate-limit-badge [aria-hidden="true"]')?.textContent).toBe("0/50");
});

it("preserves the previous result if another surface consumes the last unit", async () => {
  let attempts = 0;
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
    if ((message as { type?: string }).type === "GET_LIMITS") return quota(attempts ? 0 : 1);
    if ((message as { type?: string }).type === "IMPROVE_REQUEST") {
      if (++attempts > 1) throw new Error("API 429: Monthly improvement quota exhausted");
      return {
        request_id: "previous",
        improved_text: "Preserve my previous result",
        rate_limit: quota(1),
      };
    }
    return { ok: true };
  });
  await generate();
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Edit original")!.click(),
  );
  await act(async () => host.querySelector<HTMLButtonElement>(".btn-improve")!.click());
  expect((host.querySelector(".improved-textarea") as HTMLTextAreaElement)?.value).toBe(
    "Preserve my previous result",
  );
});

it.each(["older-first", "newer-first"])(
  "keeps the latest started quota refresh when responses finish %s",
  async (order) => {
    const pending: Array<(value: unknown) => void> = [];
    let queries = 0;
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
      if ((message as { type?: string }).type === "GET_LIMITS") {
        if (++queries === 1) return quota(7);
        return new Promise((resolve) => pending.push(resolve));
      }
      return { ok: true };
    });
    await act(async () => root.render(<App />));
    await act(async () => window.dispatchEvent(new Event("focus")));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(pending).toHaveLength(2);
    if (order === "older-first") {
      await act(async () => pending[0](quota(0)));
      expect(host.querySelector('.rate-limit-badge [aria-hidden="true"]')?.textContent).toBe(
        "7/50",
      );
      await act(async () => pending[1](quota(50, true)));
    } else {
      await act(async () => pending[1](quota(50, true)));
      await act(async () => pending[0](quota(0)));
    }
    expect(host.querySelector('.rate-limit-badge [aria-hidden="true"]')?.textContent).toBe("50/50");
  },
);

it.each(["improve", "save"])(
  "ignores stale %s recovery after a newer successful improvement",
  async (operation) => {
    const { apiClient } = await import("../shared/api-client");
    let release!: (value: unknown) => void;
    let queries = 0;
    let failImprove = false;
    let confirmed = false;
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
      const type = (message as { type?: string }).type;
      if (type === "GET_LIMITS") {
        if (++queries === 1) return quota(1);
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      if (type === "IMPROVE_REQUEST") {
        if (failImprove) {
          failImprove = false;
          throw new Error("API 429: Monthly improvement quota exhausted");
        }
        return {
          request_id: crypto.randomUUID(),
          improved_text: "Keep this result",
          rate_limit: quota(confirmed ? 50 : 1, confirmed),
        };
      }
      return { ok: true };
    });
    const edit = () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Edit original")!
        .click();
    await generate();
    if (operation === "save") {
      vi.spyOn(apiClient, "savePrompt").mockRejectedValue(
        new Error("API 429: Monthly improvement quota exhausted"),
      );
      await act(async () =>
        [...host.querySelectorAll("button")]
          .find((button) => button.textContent?.includes("Save to Library"))!
          .click(),
      );
    } else {
      failImprove = true;
      await act(async () => edit());
      await act(async () => host.querySelector<HTMLButtonElement>(".btn-improve")!.click());
    }
    await act(async () => {
      await Promise.resolve();
    });
    if (operation === "save") expect(apiClient.savePrompt).toHaveBeenCalledTimes(1);
    expect(queries).toBe(2);
    confirmed = true;
    await act(async () => edit());
    await act(async () => host.querySelector<HTMLButtonElement>(".btn-improve")!.click());
    expect(host.querySelector('.rate-limit-badge [aria-hidden="true"]')?.textContent).toBe("50/50");
    await act(async () => release(quota(0)));
    expect(host.querySelector('.rate-limit-badge [aria-hidden="true"]')?.textContent).toBe("50/50");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  },
);

it("does not offer a bonus while the zero balance is held by pending work", async () => {
  let refunded = false;
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
    const type = (message as { type?: string }).type;
    if (type === "GET_LIMITS") return quota(refunded ? 1 : 2);
    if (type === "IMPROVE_REQUEST")
      return {
        request_id: "success49",
        improved_text: "Useful result",
        rate_limit: { ...quota(0), pending_improvements: 1, exhausted: false },
      };
    return { ok: true };
  });
  await generate();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector(".upgrade-banner")?.textContent).toContain(
    "Improvements are still processing",
  );
  expect(host.querySelector(".btn-upgrade")).toBeNull();
  refunded = true;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(host.querySelector(".upgrade-banner")).toBeNull();
});

it("explains that a verified email already received its bonus instead of implying new credit", async () => {
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
    const type = (message as { type?: string }).type;
    if (type === "GET_LIMITS") return quota(0);
    if (type === "REQUEST_EMAIL_BONUS") return { sent: true };
    if (type === "CONFIRM_EMAIL_BONUS")
      return { ...quota(0, true), email_bonus_outcome: "already_claimed" };
    return { ok: true };
  });
  await act(async () => root.render(<App />));
  await act(async () => host.querySelector<HTMLButtonElement>(".btn-upgrade")!.click());
  for (const value of ["claimed@example.com", "123456"]) {
    await act(async () => {
      const input = host.querySelector(".email-bonus-modal input")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
  }
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector(".upgrade-banner")?.textContent).toContain(
    "This email has already received its bonus",
  );
  expect(host.querySelector('.rate-limit-badge [aria-hidden="true"]')?.textContent).toBe("0/50");
});
