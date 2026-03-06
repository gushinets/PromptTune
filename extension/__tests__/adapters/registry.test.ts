import { describe, it, expect } from "vitest";
import { getAdapter } from "@adapters/registry";
import { chatgptAdapter } from "@adapters/chatgpt";
import { claudeAdapter } from "@adapters/claude";
import { fallbackAdapter } from "@adapters/fallback";

describe("adapter registry", () => {
  it("returns chatgpt adapter for chatgpt.com", () => {
    expect(getAdapter("chatgpt.com")).toBe(chatgptAdapter);
  });

  it("returns claude adapter for claude.ai", () => {
    expect(getAdapter("claude.ai")).toBe(claudeAdapter);
  });

  it("returns fallback for unknown hostname", () => {
    expect(getAdapter("unknown-site.com")).toBe(fallbackAdapter);
  });
});
