/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from "vitest";
import type { Browser } from "webextension-polyfill";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  commands: {
    onCommand: { addListener: vi.fn() },
  },
} as any;

globalThis.browser = browserMock as Browser;
globalThis.chrome = globalThis.browser;

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
    runtime: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getManifest: vi.fn().mockReturnValue({ version: "0.1.0" }),
      onMessage: { addListener: vi.fn() },
    },
    tabs: {
      create: vi.fn().mockResolvedValue({ id: 1 }),
      query: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    commands: {
      onCommand: { addListener: vi.fn() },
    },
  },
}));
