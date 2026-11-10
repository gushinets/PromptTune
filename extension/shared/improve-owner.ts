import browser from "webextension-polyfill";
import { IMPROVE_OWNER_PORT } from "./messages";

export interface ImproveOwner {
  ready: Promise<void>;
  close: () => void;
}

/** Establish ownership before POSTing; the background aborts on document disconnect. */
export function createImproveOwner(requestId: string): ImproveOwner {
  const port = browser.runtime.connect({ name: IMPROVE_OWNER_PORT });
  let closed = false;
  let cancelReady = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      port.onMessage.removeListener(onReady);
      port.onDisconnect.removeListener(onDisconnect);
      if (error) reject(error);
      else resolve();
    };
    const onReady = (message: unknown) => {
      const reply = message as { ready?: boolean; client_request_id?: string } | null;
      if (reply?.ready === true && reply.client_request_id === requestId) finish();
    };
    const onDisconnect = () => finish(new Error("Improve request owner disconnected"));
    cancelReady = onDisconnect;
    port.onMessage.addListener(onReady);
    port.onDisconnect.addListener(onDisconnect);
    try {
      port.postMessage({ client_request_id: requestId });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
  return {
    ready,
    close() {
      if (closed) return;
      closed = true;
      // Locally calling disconnect does not fire this endpoint's onDisconnect.
      cancelReady();
      port.disconnect();
    },
  };
}
