import browser from "webextension-polyfill";
import { apiClient } from "@shared/api-client";
import { getInstallationId } from "@shared/storage";
import type { Message } from "@shared/messages";

export default defineBackground(() => {
  const client = "extension";
  const clientVersion = browser.runtime.getManifest().version;

  // Handle messages from popup and content scripts
  browser.runtime.onMessage.addListener(async (raw: unknown) => {
    const msg = raw as Message;

    switch (msg.type) {
      case "IMPROVE_REQUEST": {
        const installationId = await getInstallationId();
        const result = await apiClient.improve({
          text: msg.payload.text,
          goal: msg.payload.goal,
          installation_id: installationId,
          client,
          client_version: clientVersion,
          site: msg.payload.site,
          page_url: msg.payload.page_url,
          client_ts: Date.now() / 1000,
        });
        return { type: "IMPROVE_RESULT", payload: result };
      }

      case "GET_LIMITS": {
        const installationId = await getInstallationId();
        const rate_limit = await apiClient.limits(installationId);
        return { type: "LIMITS_RESULT", payload: { rate_limit } };
      }

      case "OPEN_AND_PASTE": {
        const tab = await browser.tabs.create({ url: msg.payload.url });
        // Wait for tab to load, then send paste command
        browser.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === tab.id && info.status === "complete") {
            browser.tabs.onUpdated.removeListener(listener);
            browser.tabs.sendMessage(tabId, {
              type: "PASTE_TEXT",
              payload: { text: msg.payload.text },
            });
          }
        });
        return { success: true };
      }
    }
  });

  // Handle keyboard commands
  browser.commands.onCommand.addListener(async (command) => {
    if (command === "improve-active-field") {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        browser.tabs.sendMessage(tab.id, { type: "IMPROVE_ACTIVE_FIELD" });
      }
    }
  });
});
