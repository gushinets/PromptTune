import { vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock webextension-polyfill
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
