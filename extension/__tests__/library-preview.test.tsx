import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LibraryItem } from "../entrypoints/popup/components/LibraryItem";
import type { LibraryEntry } from "@shared/storage";

let host: HTMLDivElement;
let root: Root;
let style: HTMLStyleElement;
const entry: LibraryEntry = {
  id: "long-entry",
  createdAt: Date.now(),
  site: "chatgpt",
  original: "Original prompt. ".repeat(1700),
  improved: "Improved prompt. ".repeat(1700),
};

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  style = document.createElement("style");
  style.textContent = readFileSync(resolve(__dirname, "../entrypoints/popup/App.css"), "utf8");
  document.head.append(style);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  style.remove();
  vi.useRealTimers();
});

it("bounds long saved previews while copying full text and keeping delete available", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const onDelete = vi.fn();
  try {
    await act(async () => {
      root.render(<LibraryItem entry={entry} onDelete={onDelete} />);
    });
    for (const selector of [".library-item-text", ".library-item-improved"]) {
      const preview = host.querySelector(selector)!;
      const computed = getComputedStyle(preview);
      expect(computed.overflow).toBe("hidden");
      expect(Number.parseFloat(computed.maxHeight)).toBeGreaterThan(0);
    }
    const buttons = host.querySelectorAll<HTMLButtonElement>(".library-item-actions button");
    expect(buttons).toHaveLength(2);
    await act(async () => {
      buttons[0].click();
    });
    expect(writeText).toHaveBeenCalledWith(entry.improved);
    await act(async () => {
      buttons[1].click();
    });
    expect(onDelete).toHaveBeenCalledWith(entry.id);
  } finally {
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

it.each([
  ["chatgpt", "rgb(16, 163, 127)"],
  ["claude", "rgb(249, 115, 22)"],
  ["perplexity", "rgb(34, 211, 238)"],
  ["groq", "rgb(249, 115, 22)"],
  ["deepseek", "rgb(59, 130, 246)"],
])("renders a visible site marker for %s", async (site, color) => {
  await act(async () => {
    root.render(<LibraryItem entry={{ ...entry, site }} onDelete={() => {}} />);
  });
  const marker = getComputedStyle(host.querySelector(".site-dot")!);
  expect(Number.parseFloat(marker.width)).toBeGreaterThan(0);
  expect(Number.parseFloat(marker.height)).toBeGreaterThan(0);
  expect(marker.backgroundColor).toBe(color);
});
