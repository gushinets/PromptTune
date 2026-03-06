import type { SiteAdapter } from "./types";
import { fallbackAdapter } from "./fallback";

export const groqAdapter: SiteAdapter = {
  match(hostname) {
    return hostname === "groq.com";
  },

  findComposerContainer() {
    return document.querySelector<HTMLElement>('[class*="chat-input"]');
  },

  findEditableField() {
    return document.querySelector<HTMLElement>("textarea");
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
