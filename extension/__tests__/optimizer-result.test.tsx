import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { OptimizerResult } from "../entrypoints/popup/components/OptimizerResult";
import { ru } from "../shared/i18n/ru";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("uses the approved readable Russian goal names", () => {
  expect(ru.goalStructured).toBe("Структура");
  expect(ru.goalDeepResearch).toBe("Исследование");
});

it.each([304, 30000])(
  "sizes a %ipx result to the available viewport and follows resizing",
  async (contentHeight) => {
    let viewportHeight = 480;
    let actionsHeight = 42;
    const observed = new Set<Element>();
    let resize: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe(element: Element) {
          observed.add(element);
        }
        disconnect() {}
      },
    );
    vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(contentHeight);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("result-scroll") ? viewportHeight : 0;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const top = this.tagName === "TEXTAREA" ? 30 : 0;
      const height = this.classList.contains("action-bar")
        ? actionsHeight
        : this.tagName === "SUMMARY"
          ? 44
          : 0;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        right: 320,
        bottom: top + height,
        width: 320,
        height,
        toJSON() {},
      };
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          <OptimizerResult
            improved={"Long prompt. ".repeat(2000)}
            changes={["A change"]}
            goal="general"
            hidden={false}
            actions={
              <div className="action-bar">
                <button>Copy</button>
              </div>
            }
            onEdit={() => {}}
            onNew={() => {}}
          />,
        );
      });
      const field = host.querySelector("textarea")!;
      expect(Number.parseFloat(field.style.height)).toBe(contentHeight === 304 ? 304 : 408);
      expect(field.value).toHaveLength(26000);
      viewportHeight = 350;
      await act(async () => {
        resize?.([], {} as ResizeObserver);
      });
      expect(Number.parseFloat(field.style.height)).toBe(278);
      // An action failure adds feedback without resizing the viewport.
      actionsHeight = 88;
      await act(async () => {
        if (observed.has(host.querySelector(".action-bar")!)) resize?.([], {} as ResizeObserver);
      });
      expect(Number.parseFloat(field.style.height)).toBe(232);
      viewportHeight = 800;
      await act(async () => {
        resize?.([], {} as ResizeObserver);
      });
      expect(Number.parseFloat(field.style.height)).toBe(Math.min(contentHeight, 682));
      expect(host.querySelector("button")?.textContent).toBe("Copy");
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    }
  },
);
