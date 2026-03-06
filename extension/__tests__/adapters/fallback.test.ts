import { describe, it, expect } from "vitest";
import { fallbackAdapter } from "@adapters/fallback";

describe("fallback adapter", () => {
  it("matches any hostname", () => {
    expect(fallbackAdapter.match("anything.com")).toBe(true);
  });

  it("findComposerContainer returns null", () => {
    expect(fallbackAdapter.findComposerContainer()).toBeNull();
  });

  it("getText reads value from textarea", () => {
    const el = document.createElement("textarea");
    el.value = "hello";
    expect(fallbackAdapter.getText(el)).toBe("hello");
  });

  it("setText writes value and dispatches input event", () => {
    const el = document.createElement("textarea");
    let inputFired = false;
    el.addEventListener("input", () => (inputFired = true));

    fallbackAdapter.setText(el, "new text");

    expect(el.value).toBe("new text");
    expect(inputFired).toBe(true);
  });
});
