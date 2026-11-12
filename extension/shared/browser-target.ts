import browser from "webextension-polyfill";

export class SourceSessionEndedError extends Error {
  constructor() {
    super("The original browser session has ended. Start a new prompt.");
    this.name = "SourceSessionEndedError";
  }
}

const BROWSER_SESSION_KEY = "optimizer_browser_session";
let initialization: Promise<string> | undefined;

/** Called by the background selection producer; session storage survives worker suspension. */
export function ensureBrowserSessionId(): Promise<string> {
  initialization ??= (async () => {
    const data = await browser.storage.session.get(BROWSER_SESSION_KEY);
    const existing = data[BROWSER_SESSION_KEY];
    if (typeof existing === "string" && existing) return existing;
    const id = crypto.randomUUID();
    await browser.storage.session.set({ [BROWSER_SESSION_KEY]: id });
    return id;
  })().catch((error) => {
    initialization = undefined;
    throw error;
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
