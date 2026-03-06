import type { SiteAdapter } from "./types";
import { fallbackAdapter } from "./fallback";

export const chatgptAdapter: SiteAdapter = {
  match(hostname) {
    return hostname === "chatgpt.com";
  },

  findComposerContainer() {
    return document.querySelector<HTMLElement>("#composer-background");
  },

  findEditableField() {
    return document.querySelector<HTMLElement>("#prompt-textarea");
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
