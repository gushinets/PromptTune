import type { SiteAdapter } from "./types";

function dispatchInputEvent(el: HTMLElement) {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export const fallbackAdapter: SiteAdapter = {
  match() {
    return true;
  },

  findComposerContainer() {
    return null;
  },

  findEditableField() {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return null;

    if (
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLInputElement ||
      active.getAttribute("contenteditable") === "true"
    ) {
      return active;
    }

    return null;
  },

  getText(el: HTMLElement): string {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      return el.value;
    }
    return el.innerText ?? el.textContent ?? "";
  },

  setText(el: HTMLElement, text: string): void {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      // Bypass framework value trackers so the input event updates controlled state.
      const prototype =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(el, text);
    } else {
      el.innerText = text;
    }
    dispatchInputEvent(el);
  },

  mountToolbar() {
    // Fallback: no toolbar mount
  },
};
