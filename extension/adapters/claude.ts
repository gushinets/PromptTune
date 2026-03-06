import type { SiteAdapter } from "./types";
import { fallbackAdapter } from "./fallback";

export const claudeAdapter: SiteAdapter = {
  match(hostname) {
    return hostname === "claude.ai";
  },

  findComposerContainer() {
    return document.querySelector<HTMLElement>('[class*="composer"]');
  },

  findEditableField() {
    return document.querySelector<HTMLElement>('[contenteditable="true"]');
  },

  getText(el) {
    return fallbackAdapter.getText(el);
  },

  setText(el, text) {
    fallbackAdapter.setText(el, text);
  },

  mountToolbar(_container) {
    // TODO: V2 toolbar mount
  },
};
