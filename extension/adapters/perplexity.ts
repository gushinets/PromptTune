import type { SiteAdapter } from "./types";
import { fallbackAdapter } from "./fallback";

export const perplexityAdapter: SiteAdapter = {
  match(hostname) {
    return hostname === "www.perplexity.ai";
  },

  findComposerContainer() {
    return document.querySelector<HTMLElement>('[class*="query"]');
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
