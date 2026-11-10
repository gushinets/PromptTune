/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from "vitest";
import type { Browser } from "webextension-polyfill";

const testGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
  browser: Browser;
  chrome: Browser;
};
testGlobals.IS_REACT_ACT_ENVIRONMENT = true;

const browserMock = {
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    getManifest: vi.fn().mockReturnValue({ version: "0.1.0" }),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    getURL: vi.fn((path: string) => path),
    id: "test-extension-id",
  },
  tabs: {
    create: vi.fn().mockResolvedValue({ id: 1 }),
    query: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  commands: {
    onCommand: { addListener: vi.fn() },
  },
} as any;

testGlobals.browser = browserMock as Browser;
testGlobals.chrome = testGlobals.browser;

vi.mock("webextension-polyfill", async () => {
  const { createPortPair } = await import("./port-mock");
  return {
    default: {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
        },
      },
      runtime: {
        onConnect: { addListener: vi.fn() },
        connect: vi.fn(() => {
          const { client, server } = createPortPair();
          server.onMessage.addListener((message: unknown) => {
            server.postMessage({
              ready: true,
              client_request_id: (message as { client_request_id: string }).client_request_id,
            });
          });
          return client;
        }),
        sendMessage: vi.fn().mockResolvedValue(undefined),
        getManifest: vi.fn().mockReturnValue({ version: "0.1.0" }),
        getURL: vi.fn((path: string) => path),
        onMessage: { addListener: vi.fn() },
      },
      tabs: {
        create: vi.fn().mockResolvedValue({ id: 1 }),
        query: vi.fn().mockResolvedValue([]),
        sendMessage: vi.fn().mockResolvedValue(undefined),
        onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      commands: {
        onCommand: { addListener: vi.fn() },
      },
    },
  };
});
