import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { App } from "../entrypoints/popup/App";
import { en } from "@shared/i18n/en";
import { ru } from "@shared/i18n/ru";
import { createPortPair } from "./port-mock";

const language = vi.hoisted(() => ({ value: "en" }));
vi.mock("@shared/i18n", async (original) => ({
  ...(await original<typeof import("@shared/i18n")>()),
  useT: () => (language.value === "ru" ? ru : en),
}));
vi.mock("@shared/constants", async (original) => ({
  ...(await original<typeof import("@shared/constants")>()),
  ANALYTICS_ENABLED: false,
}));

let root: Root;
let host: HTMLDivElement;
let failure: { status: number; detail: string } | "network" | "aborted" | "pending" | null;
const quota = {
  per_minute_remaining: 10,
  per_minute_total: 10,
  per_day_remaining: 50,
  per_day_total: 50,
};

beforeEach(async () => {
  vi.clearAllMocks();
  failure = { status: 502, detail: "Controlled acceptance failure" };
  language.value = "en";
  vi.stubGlobal("defineBackground", (main: () => void) => main);
  Object.assign(browser, { permissions: { onRemoved: { addListener: vi.fn() } } });
  Object.assign(browser.runtime, { onInstalled: { addListener: vi.fn() } });
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    installation_id: "i",
    registered_installation_id: "i",
    audience_mode: "ai",
    library: [],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, options?: RequestInit) => {
      if (String(url).endsWith("/v1/config"))
        return new Response(JSON.stringify({ prompt_input_max_chars: 30000 }));
      if (String(url).includes("/v1/limits")) return new Response(JSON.stringify(quota));
      if (!String(url).endsWith("/v1/improve")) throw new Error(`Unexpected URL: ${url}`);
      if (failure === "aborted") throw new DOMException("Aborted", "AbortError");
      if (failure === "pending")
        return new Promise<Response>((_resolve, reject) => {
          options!.signal!.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      if (failure === "network") throw new TypeError("Failed to fetch");
      return failure
        ? new Response(JSON.stringify({ detail: failure.detail }), { status: failure.status })
        : new Response(
            JSON.stringify({
              request_id: "recovered",
              improved_text: "Recovered result",
              rate_limit: quota,
            }),
          );
    }),
  );
  const { default: main } = await import("../entrypoints/background/index");
  (main as unknown as () => void)();
  const handle = vi
    .mocked(browser.runtime.onMessage.addListener)
    .mock.calls.at(-1)![0] as unknown as (message: unknown, sender: unknown) => Promise<unknown>;
  // Real listener and API client, with Chrome's JSON boundary and rejection wrapping.
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: unknown) => {
    try {
      const response = await handle(JSON.parse(JSON.stringify(message)), {});
      return response === undefined ? undefined : JSON.parse(JSON.stringify(response));
    } catch (error) {
      throw new Error(`Uncaught ${String(error)}`);
    }
  });
  vi.mocked(browser.runtime.connect).mockImplementation(() => {
    const { client, server } = createPortPair();
    vi.mocked(browser.runtime.onConnect.addListener).mock.calls.at(-1)![0](server);
    return client;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function start(viewMode: "popup" | "sidepanel", expectError = true) {
  await act(async () => root.render(<App viewMode={viewMode} />));
  await act(async () => {
    const field = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      field,
      "Original prompt",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const goals = host.querySelectorAll<HTMLInputElement>(".goal-pill-input");
  await act(async () => goals[1]!.click());
  const goal = host.querySelector<HTMLInputElement>(".goal-pill-input:checked")!.value;
  await act(async () => host.querySelector<HTMLButtonElement>(".btn-improve")!.click());
  if (expectError) expect(host.querySelector(".error-toast")).not.toBeNull();
  return goal;
}

it.each(["popup", "sidepanel"] as const)(
  "localizes 502 in %s, keeps input/mode/goal and allows recovery",
  async (viewMode) => {
    const goal = await start(viewMode);
    expect(host.querySelector(".error-toast-message")?.textContent).toBe(
      "The service is temporarily unavailable. Please try again in a few minutes.",
    );
    expect(host.textContent).not.toMatch(/Uncaught|ApiError|API 502|Controlled acceptance/);
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Original prompt");
    expect(host.querySelector('[data-mode="ai"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector<HTMLInputElement>(".goal-pill-input:checked")!.value).toBe(goal);
    expect(host.querySelector<HTMLButtonElement>(".btn-improve")!.disabled).toBe(false);
    failure = null;
    await act(async () => host.querySelector<HTMLButtonElement>(".btn-improve")!.click());
    expect(host.textContent).toContain("Recovered result");
    expect(host.querySelector(".error-toast")).toBeNull();
  },
);

it.each(["popup", "sidepanel"] as const)("localizes 502 in Russian in %s", async (viewMode) => {
  language.value = "ru";
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    installation_id: "i",
    registered_installation_id: "i",
    audience_mode: "content",
    library: [],
  });
  await start(viewMode);
  expect(host.querySelector(".error-toast-message")?.textContent).toBe(
    "Сервис временно недоступен. Попробуйте снова через несколько минут.",
  );
  expect(host.querySelector('[data-mode="content"]')?.getAttribute("aria-pressed")).toBe("true");
});

it.each([
  ["popup", 502, "The service is temporarily unavailable. Please try again in a few minutes.", 1],
  [
    "sidepanel",
    502,
    "The service is temporarily unavailable. Please try again in a few minutes.",
    1,
  ],
  ["popup", 429, en.quotaPending, 2],
  ["sidepanel", 429, en.quotaPending, 2],
] as const)(
  "prioritizes HTTP status over pending-quota provider text in %s (%s)",
  async (viewMode, status, expected, quotaLookups) => {
    failure = {
      status,
      detail: "Provider reports tokens temporarily reserved by pending requests",
    };
    await start(viewMode);
    expect(host.querySelector(".error-toast-message")?.textContent).toBe(expected);
    // Only quota failures should trigger an additional balance-recovery request.
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/v1/limits")),
    ).toHaveLength(quotaLookups);
  },
);

it.each([
  [422, "Input text exceeds maximum length of 8000 characters.", "Text is too long"],
  [422, "Please choose a goal", "Please choose a goal"],
  [429, "Rate limit exceeded", en.quotaTemporary],
  [429, "Monthly improvement quota exhausted", "improvements this month"],
  [429, "Monthly improvement quota temporarily reserved by pending requests", en.quotaPending],
] as const)(
  "preserves HTTP %s handling (%s) through the channel",
  async (status, detail, expected) => {
    failure = { status, detail };
    await start("popup");
    expect(host.querySelector(".error-toast-message")?.textContent).toContain(expected);
  },
);

it("preserves network error handling through the channel", async () => {
  failure = "network";
  await start("popup");
  expect(host.querySelector(".error-toast-message")?.textContent).toBe(en.errorNetworkMessage);
});

it.each(["popup", "sidepanel"] as const)(
  "keeps cancellation silent and allows retry in %s",
  async (viewMode) => {
    failure = "pending";
    await start(viewMode, false);
    expect(host.querySelector(".processing-screen")).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>(".btn-cancel")!.click());
    expect(host.querySelector(".processing-screen")).toBeNull();
    expect(host.querySelector(".error-toast")).toBeNull();
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Original prompt");
    failure = null;
    await act(async () => host.querySelector<HTMLButtonElement>(".btn-improve")!.click());
    expect(host.textContent).toContain("Recovered result");
  },
);

it("does not show an aborted response as a service error", async () => {
  failure = "aborted";
  await start("popup", false);
  expect(host.querySelector(".error-toast")).toBeNull();
  expect(host.querySelector<HTMLButtonElement>(".btn-improve")!.disabled).toBe(false);
});

it.each([
  ["popup", "en"],
  ["sidepanel", "en"],
  ["popup", "ru"],
  ["sidepanel", "ru"],
] as const)(
  "localizes a pending-quota preflight 502 in %s (%s) and permits retry",
  async (viewMode, locale) => {
    language.value = locale;
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    let quotaCalls = 0;
    let failPreflight = true;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (String(args[0]).includes("/v1/limits")) {
        quotaCalls++;
        if (quotaCalls === 1)
          return new Response(
            JSON.stringify({
              ...quota,
              remaining: 0,
              per_day_remaining: 0,
              pending_improvements: 1,
              exhausted: false,
            }),
          );
        if (failPreflight)
          return new Response(JSON.stringify({ detail: "Controlled quota preflight failure" }), {
            status: 502,
          });
      }
      return originalFetch(...args);
    });
    failure = null;
    const goal = await start(viewMode);
    expect(host.querySelector(".error-toast-message")?.textContent).toBe(
      locale === "ru"
        ? "Сервис временно недоступен. Попробуйте снова через несколько минут."
        : "The service is temporarily unavailable. Please try again in a few minutes.",
    );
    expect(host.textContent).not.toMatch(/Uncaught|ApiError|API 502/);
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Original prompt");
    expect(host.querySelector<HTMLInputElement>(".goal-pill-input:checked")!.value).toBe(goal);
    expect(host.querySelector<HTMLButtonElement>(".btn-improve")!.disabled).toBe(false);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/v1/improve"))).toBe(
      false,
    );
    failPreflight = false;
    await act(async () => host.querySelector<HTMLButtonElement>(".btn-improve")!.click());
    expect(host.textContent).toContain("Recovered result");
    expect(host.querySelector(".error-toast")).toBeNull();
  },
);
