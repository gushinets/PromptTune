import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { EmailBonusModal } from "../entrypoints/popup/components/EmailBonusModal";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
it("requires email proof before reporting credit, and supports dismissal", async () => {
  const onConfirmed = vi.fn();
  const onClose = vi.fn();
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
    if ((message as { type?: string }).type === "REQUEST_EMAIL_BONUS") return { sent: true };
    return {
      remaining: 50,
      total: 100,
      bonus_claimed: true,
      email_verified: true,
      next_reset_at: "2027-01-01T21:00:00Z",
      per_day_remaining: 50,
      per_day_total: 100,
      per_minute_remaining: 10,
      per_minute_total: 10,
    };
  });
  await act(async () =>
    root.render(<EmailBonusModal onClose={onClose} onConfirmed={onConfirmed} />),
  );
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "a@example.com",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(onConfirmed).not.toHaveBeenCalled();
  expect(host.querySelector("input")?.getAttribute("inputmode")).toBe("numeric");
  await act(async () => {
    const code = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(code, "123456");
    code.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(onConfirmed).toHaveBeenCalledWith(expect.objectContaining({ remaining: 50 }));
  await act(async () => host.querySelector<HTMLButtonElement>("[data-close]")!.click());
  expect(onClose).toHaveBeenCalled();
});
it("shows delivery failures without granting credit", async () => {
  const onConfirmed = vi.fn();
  vi.mocked(browser.runtime.sendMessage).mockRejectedValue(new Error("Unable to send email"));
  await act(async () =>
    root.render(<EmailBonusModal onClose={vi.fn()} onConfirmed={onConfirmed} />),
  );
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Unable to send email");
  expect(onConfirmed).not.toHaveBeenCalled();
});

it("restores an existing email challenge without sending another code", async () => {
  vi.mocked(browser.runtime.sendMessage).mockClear();
  await act(async () =>
    root.render(
      <EmailBonusModal
        onClose={vi.fn()}
        onConfirmed={vi.fn()}
        initialQuota={{
          email: "pending@example.com",
          verification_pending: true,
          verification_resend_at: new Date(Date.now() + 40_000).toISOString(),
          per_day_remaining: 0,
          per_day_total: 50,
          per_minute_remaining: 10,
          per_minute_total: 10,
        }}
      />,
    ),
  );
  expect(host.querySelector("input")?.getAttribute("inputmode")).toBe("numeric");
  expect(host.textContent).toContain("pending@example.com");
  expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
});
