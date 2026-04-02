import { vi } from "vitest";

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
