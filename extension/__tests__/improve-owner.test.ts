import { afterEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { createImproveOwner } from "@shared/improve-owner";
import { createPortPair } from "./port-mock";

afterEach(() => vi.restoreAllMocks());

it("waits for a matching background ownership acknowledgement", async () => {
  const { client, server } = createPortPair();
  vi.mocked(browser.runtime.connect).mockReturnValueOnce(client);
  const owner = createImproveOwner("r1");
  let ready = false;
  void owner.ready.then(() => {
    ready = true;
  });
  server.postMessage({ ready: true, client_request_id: "other" });
  await Promise.resolve();
  expect(ready).toBe(false);
  server.postMessage({ ready: true, client_request_id: "r1" });
  await owner.ready;
  expect(ready).toBe(true);
  owner.close();
});

it.each(["local", "remote"])("rejects a pending claim on %s disconnect", async (side) => {
  const { client, server } = createPortPair();
  vi.mocked(browser.runtime.connect).mockReturnValueOnce(client);
  const owner = createImproveOwner("r2");
  const rejected = expect(owner.ready).rejects.toThrow("disconnected");
  if (side === "local") {
    owner.close();
    owner.close();
  } else server.disconnect();
  await rejected;
  expect(client.onMessage.removeListener).toHaveBeenCalled();
});
