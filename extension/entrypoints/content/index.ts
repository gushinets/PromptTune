import browser from "webextension-polyfill";
import { getAdapter } from "@adapters/registry";
import { extractImproveResponse } from "@shared/response-utils";
import type { Message } from "@shared/messages";

export default defineContentScript({
  matches: [
    "https://chatgpt.com/*",
    "https://claude.ai/*",
    "https://www.perplexity.ai/*",
    "https://groq.com/*",
    "https://chat.deepseek.com/*",
  ],
  main() {
    let lastFocusedField: HTMLElement | null = null;

    // Track the last focused editable field
    document.addEventListener("focusin", (e) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement ||
        target.getAttribute("contenteditable") === "true"
      ) {
        lastFocusedField = target;
      }
    });

    const adapter = getAdapter(location.hostname);

    // Listen for messages from background
    browser.runtime.onMessage.addListener(async (raw: unknown) => {
      const msg = raw as Message;

      switch (msg.type) {
        case "PASTE_TEXT": {
          const field = adapter.findEditableField() ?? lastFocusedField;
          if (field) {
            adapter.setText(field, msg.payload.text);
          }
          break;
        }

        case "IMPROVE_ACTIVE_FIELD": {
          const field = adapter.findEditableField() ?? lastFocusedField;
          if (!field) {
            // Simple UX: inform the user they need to focus a field first
            // without breaking the page UX.
            try {
              alert("Focus an input field first, then use the improve command.");
            } catch {
              // In case alerts are blocked, fail silently.
            }
            return;
          }
          const text = adapter.getText(field);
          if (!text.trim()) return;

          const response = await browser.runtime.sendMessage({
            type: "IMPROVE_REQUEST",
            payload: {
              text,
              goal: "general",
              site: location.hostname,
              page_url: location.href,
            },
          });
          const result = extractImproveResponse(response);

          if (result?.improved_text.trim()) {
            adapter.setText(field, result.improved_text);
          }
          break;
        }
      }
    });

    // Mount toolbar (V2) if adapter supports it
    const container = adapter.findComposerContainer();
    if (container) {
      adapter.mountToolbar(container);
    }
  },
});
