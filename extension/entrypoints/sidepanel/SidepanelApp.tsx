import { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import { isPanelHandoff, panelHandoffPrefix, type PanelHandoff } from "@shared/panel-handoff";
import { App } from "../popup/App";

/** Receive sessions for this window, including when its side panel is already open. */
export function SidepanelApp() {
  const [session, setSession] = useState<PanelHandoff>();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    void (async () => {
      try {
        const window = await browser.windows.getCurrent();
        if (!active || window.id === undefined) return;
        const prefix = panelHandoffPrefix(window.id);
        let revision = 0;
        const accept = (key: string, value: unknown) => {
          if (!active || !isPanelHandoff(value)) return;
          setSession(value);
          void browser.storage.local.remove(key).catch(() => undefined);
        };
        const onChanged = (
          changes: Record<string, browser.Storage.StorageChange>,
          area: string,
        ) => {
          if (area !== "local") return;
          for (const [key, change] of Object.entries(changes)) {
            if (!key.startsWith(prefix) || !isPanelHandoff(change.newValue)) continue;
            revision++;
            accept(key, change.newValue);
          }
        };
        browser.storage.onChanged.addListener(onChanged);
        unsubscribe = () => browser.storage.onChanged.removeListener(onChanged);
        const initialRevision = revision;
        const data = await browser.storage.local.get(null);
        const pending = Object.entries(data).filter(([key]) => key.startsWith(prefix));
        let acceptedKey: string | undefined;
        if (revision === initialRevision) {
          const newest = pending
            .filter((entry): entry is [string, PanelHandoff] => isPanelHandoff(entry[1]))
            .sort((a, b) => b[1].expiresAt - a[1].expiresAt)[0];
          if (newest) {
            acceptedKey = newest[0];
            accept(...newest);
          }
        }
        // Unique keys let us retire this snapshot without deleting a concurrent transfer.
        const obsolete = pending.map(([key]) => key).filter((key) => key !== acceptedKey);
        if (obsolete.length) await browser.storage.local.remove(obsolete).catch(() => undefined);
      } catch {
        // A failed transfer read must not prevent the normal draft flow from opening.
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return ready ? (
    <App key={session?.id ?? "draft"} viewMode="sidepanel" initialDraft={session?.draft} />
  ) : null;
}
