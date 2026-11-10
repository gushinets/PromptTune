import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { PrivateSelectionNotice } from "../entrypoints/popup/PrivateSelectionNotice";

it("explains the private-mode restriction without loading drafts or sending text", async () => {
  vi.clearAllMocks();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  try {
    await act(async () => root.render(<PrivateSelectionNotice />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "private browsing is not supported",
    );
    expect(host.querySelector("textarea")).toBeNull();
    expect(browser.storage.local.get).not.toHaveBeenCalled();
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    await act(async () => host.querySelector("button")!.click());
    expect(close).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    close.mockRestore();
  }
});
