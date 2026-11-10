import browser from "webextension-polyfill";

export const SELECTION_MENU_ID = "optimize-selection";
const SELECTION_KEY_PREFIX = "optimizer_selection_";

export interface PromptSelection {
  text: string;
  sourceTabId?: number;
}

export async function openSelection(text: string, sourceTabId?: number): Promise<void> {
  const key = `${SELECTION_KEY_PREFIX}${crypto.randomUUID()}`;
  await browser.storage.local.set({ [key]: { text, sourceTabId } });
  try {
    await browser.windows.create({
      url: `${browser.runtime.getURL("popup.html")}?selection=${key}`,
      type: "popup",
      width: 380,
      height: 660,
    });
  } catch (error) {
    await browser.storage.local.remove(key);
    throw error;
  }
}

/** Consume only the payload addressed to this window, never a shared pending draft. */
export async function takeSelection(search: string): Promise<PromptSelection | undefined> {
  const key = new URLSearchParams(search).get("selection");
  if (!key?.startsWith(SELECTION_KEY_PREFIX)) return;
  const data = await browser.storage.local.get(key);
  await browser.storage.local.remove(key);
  const value = data[key] as Partial<PromptSelection> | undefined;
  if (typeof value?.text !== "string" || !value.text.trim()) return;
  return {
    text: value.text,
    sourceTabId: typeof value.sourceTabId === "number" ? value.sourceTabId : undefined,
  };
}
