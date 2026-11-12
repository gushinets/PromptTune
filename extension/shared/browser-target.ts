import browser from "webextension-polyfill";

export class SourceSessionEndedError extends Error {
  constructor() {
    super("The original browser session has ended. Start a new prompt.");
    this.name = "SourceSessionEndedError";
  }
}

const BROWSER_SESSION_KEY = "optimizer_browser_session";
let initialization: Promise<string> | undefined;

/** Read the nonce without creating a session while validating an old transfer. */
export async function getBrowserSessionId(): Promise<string | undefined> {
  const data = await browser.storage.session.get(BROWSER_SESSION_KEY);
  const id = data[BROWSER_SESSION_KEY];
  return typeof id === "string" && id ? id : undefined;
}

/** Share one nonce across producers and surfaces, including concurrent first opens. */
export function ensureBrowserSessionId(): Promise<string> {
  const initialize = async () => {
    const existing = await getBrowserSessionId();
    if (existing) return existing;
    const id = crypto.randomUUID();
    await browser.storage.session.set({ [BROWSER_SESSION_KEY]: id });
    return id;
  };
  initialization ??= Promise.resolve(
    navigator.locks
      ? navigator.locks.request("prompttune-browser-session", initialize)
      : initialize(),
  ).finally(() => {
    initialization = undefined;
  });
  return initialization;
}

/** Never use a restored numeric tab ID unless it belongs to this browser session. */
export async function resolveBrowserTarget(tabId?: number, sessionId?: string) {
  if (tabId !== undefined) {
    const data = await browser.storage.session.get(BROWSER_SESSION_KEY);
    if (!sessionId || data[BROWSER_SESSION_KEY] !== sessionId) {
      throw new SourceSessionEndedError();
    }
    try {
      return await browser.tabs.get(tabId);
    } catch {
      throw new SourceSessionEndedError();
    }
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}
