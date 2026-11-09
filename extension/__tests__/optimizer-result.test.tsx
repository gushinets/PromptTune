import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { OptimizerResult } from "../entrypoints/popup/components/OptimizerResult";

it("bounds long output height so result actions stay close to the visible prompt", async () => {
  const height = vi
    .spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get")
    .mockReturnValue(30000);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <OptimizerResult
          improved={"Long prompt. ".repeat(2000)}
          changes={[]}
          goal="general"
          hidden={false}
          actions={<button>Copy</button>}
          onEdit={() => {}}
          onNew={() => {}}
        />,
      );
    });
    const field = host.querySelector("textarea")!;
    expect(Number.parseFloat(field.style.height)).toBeLessThanOrEqual(240);
    expect(field.value).toHaveLength(26000);
    expect(host.querySelector("button")?.textContent).toBe("Copy");
  } finally {
    await act(async () => {
      root.unmount();
    });
    height.mockRestore();
    host.remove();
  }
});
