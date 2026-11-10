import { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import { isPanelHandoff, panelHandoffKey, type PanelHandoff } from "@shared/panel-handoff";
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
        const key = panelHandoffKey(window.id);
        let revision = 0;
        const accept = (value: unknown) => {
          if (!active || !isPanelHandoff(value)) return;
          setSession(value);
          void browser.storage.local.remove(key).catch(() => undefined);
        };
        const onChanged = (
          changes: Record<string, browser.Storage.StorageChange>,
          area: string,
        ) => {
          if (area !== "local" || !changes[key]) return;
          revision++;
          accept(changes[key].newValue);
        };
        browser.storage.onChanged.addListener(onChanged);
        unsubscribe = () => browser.storage.onChanged.removeListener(onChanged);
        const initialRevision = revision;
        const data = await browser.storage.local.get(key);
        if (revision === initialRevision) accept(data[key]);
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
