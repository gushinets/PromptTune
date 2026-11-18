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
    vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockImplementation(function (
      this: HTMLTextAreaElement,
    ) {
      // A layout read after shrinking the field can clamp the outer scroll offset.
      if (this.style.height === "auto") this.closest(".result-scroll")!.scrollTop = 0;
      return contentHeight;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("result-scroll") ? viewportHeight : 0;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const top =
        this.tagName === "TEXTAREA" ? 30 - (this.closest(".result-scroll")?.scrollTop ?? 0) : 0;
      const height = this.classList.contains("action-bar")
        ? actionsHeight
        : this.tagName === "DETAILS"
          ? (this as HTMLDetailsElement).open
            ? 240
            : 44
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
      const details = host.querySelector("details")!;
      details.open = true;
      await act(async () => {
        if (observed.has(host.querySelector(".result-scroll")!)) resize?.([], {} as ResizeObserver);
      });
      expect(Number.parseFloat(field.style.height)).toBe(contentHeight === 304 ? 304 : 408);
      viewportHeight = 350;
      await act(async () => {
        if (observed.has(host.querySelector(".result-scroll")!)) resize?.([], {} as ResizeObserver);
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
        if (observed.has(host.querySelector(".result-scroll")!)) resize?.([], {} as ResizeObserver);
      });
      expect(Number.parseFloat(field.style.height)).toBe(Math.min(contentHeight, 682));
      expect(host.querySelector("button")?.textContent).toBe("Copy");
      const container = host.querySelector(".result-scroll")!;
      container.scrollTop = 140;
      await act(async () => {
        if (observed.has(container)) resize?.([], {} as ResizeObserver);
      });
      expect(container.scrollTop).toBe(140);
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    }
  },
);

it.each([80, 140])(
  "reveals new clipped action feedback while preserving already visible feedback (%ipx)",
  async (feedbackBottom) => {
    let resize: ResizeObserverCallback | undefined;
    const observed = new Set<Element>();
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
    vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("result-scroll") ? 100 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const height = this.classList.contains("action-feedback")
        ? 40
        : this.classList.contains("action-bar")
          ? 70
          : 0;
      const top = this.classList.contains("action-feedback") ? feedbackBottom - height : 0;
      return {
        top,
        bottom: top + height,
        left: 0,
        right: 320,
        x: 0,
        y: top,
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
            improved="Long output"
            changes={[]}
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
      const container = host.querySelector(".result-scroll")!;
      container.scrollTop = 50;
      const feedback = document.createElement("p");
      feedback.className = "action-feedback";
      feedback.setAttribute("role", "alert");
      feedback.textContent = "Copy failed";
      const actions = host.querySelector(".action-bar")!;
      actions.append(feedback);
      await act(async () => {
        if (observed.has(actions)) resize?.([], {} as ResizeObserver);
      });
      expect(host.querySelector("textarea")!.style.height).toBe("120px");
      expect(container.scrollTop).toBe(feedbackBottom > 100 ? 90 : 50);
      // Subsequent resizes must not pull the reader back to an existing message.
      container.scrollTop = 10;
      await act(async () => {
        if (observed.has(actions)) resize?.([], {} as ResizeObserver);
      });
      expect(container.scrollTop).toBe(10);
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    }
  },
);

it("keeps the first visible explanation at the same offset when result height changes", async () => {
  let viewportHeight = 480;
  let resize: ResizeObserverCallback | undefined;
  const observed = new Set<Element>();
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
  vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("result-scroll") ? viewportHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const container = this.closest(".result-scroll");
    const field = container?.querySelector("textarea");
    const fieldHeight = Number.parseFloat(field?.style.height ?? "0") || 0;
    const offset = container?.scrollTop ?? 0;
    const top =
      this.tagName === "LI"
        ? fieldHeight + 100 - offset
        : this.tagName === "SUMMARY"
          ? fieldHeight + 60 - offset
          : this.tagName === "TEXTAREA"
            ? 30 - offset
            : 0;
    const height =
      this.tagName === "LI"
        ? 60
        : this.tagName === "SUMMARY"
          ? 20
          : this.classList.contains("action-bar")
            ? 42
            : 0;
    return {
      top,
      bottom: top + height,
      left: 0,
      right: 320,
      x: 0,
      y: top,
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
          improved="Long output"
          changes={["First explanation", "Second explanation"]}
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
    const container = host.querySelector(".result-scroll")!;
    host.querySelector("details")!.open = true;
    container.scrollTop = 498;
    container.dispatchEvent(new Event("scroll"));
    const explanation = host.querySelector("li")!;
    expect(explanation.getBoundingClientRect().top).toBe(10);
    viewportHeight = 280;
    await act(async () => {
      if (observed.has(container)) resize?.([], {} as ResizeObserver);
    });
    expect(explanation.getBoundingClientRect().top).toBe(10);
    viewportHeight = 480;
    await act(async () => {
      if (observed.has(container)) resize?.([], {} as ResizeObserver);
    });
    expect(explanation.getBoundingClientRect().top).toBe(10);
    // Chromium can clamp the old offset before delivering ResizeObserver.
    viewportHeight = 650;
    container.scrollTop = 350;
    container.dispatchEvent(new Event("scroll"));
    await act(async () => {
      if (observed.has(container)) resize?.([], {} as ResizeObserver);
    });
    expect(explanation.getBoundingClientRect().top).toBe(10);
    viewportHeight = 280;
    await act(async () => {
      if (observed.has(container)) resize?.([], {} as ResizeObserver);
    });
    expect(explanation.getBoundingClientRect().top).toBe(10);
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
});

it.each([
  [0, 100],
  [10, 100],
  [10, 200],
])(
  "keeps the focused action and its outline visible when an error needs a toast (top=%ipx, initial height=%ipx)",
  async (focusTop, initialHeight) => {
    let viewportHeight = initialHeight;
    let resize: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("result-scroll") ? viewportHeight : 0;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const offset = (this.closest(".result-scroll")?.scrollTop ?? 50) - 50;
      const top = this.classList.contains("action-feedback")
        ? 100 - offset
        : this.tagName === "BUTTON"
          ? focusTop - offset
          : 0;
      const height = this.classList.contains("action-feedback")
        ? 40
        : this.tagName === "BUTTON"
          ? 34
          : 0;
      return {
        top,
        bottom: top + height,
        left: 0,
        right: 280,
        x: 0,
        y: top,
        width: 280,
        height,
        toJSON() {},
      };
    });
    const host = document.createElement("div");
    document.body.append(host);
    const headerControl = document.createElement("button");
    headerControl.textContent = "Library";
    document.body.prepend(headerControl);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          <OptimizerResult
            improved="Long output"
            changes={[]}
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
      const container = host.querySelector(".result-scroll")!;
      container.scrollTop = 50;
      const button = host.querySelector("button")!;
      button.focus();
      const feedback = document.createElement("p");
      feedback.className = "action-feedback";
      feedback.setAttribute("role", "alert");
      feedback.textContent = "Copy failed";
      host.querySelector(".action-bar")!.append(feedback);
      await act(async () => {
        resize?.([], {} as ResizeObserver);
      });
      if (initialHeight > 100) {
        expect(document.querySelector(".action-error-toast")).toBeNull();
        viewportHeight = 100;
        await act(async () => {
          resize?.([], {} as ResizeObserver);
        });
      }
      expect(document.activeElement).toBe(button);
      expect(container.scrollTop).toBe(focusTop === 0 ? 45 : 50);
      expect(document.querySelector(".action-error-toast .error-toast-message")?.textContent).toBe(
        "Copy failed",
      );
      await act(async () => {
        feedback.textContent = "Save failed";
      });
      expect(document.querySelector(".action-error-toast .error-toast-message")?.textContent).toBe(
        "Save failed",
      );
      expect.soft(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
      await act(async () => {
        headerControl.focus();
      });
      expect(document.activeElement).toBe(headerControl);
      expect(document.querySelector(".action-error-toast")).toBeNull();
      const readingPosition = container.scrollTop;
      viewportHeight = 80;
      await act(async () => {
        resize?.([], {} as ResizeObserver);
      });
      expect(container.scrollTop).toBe(readingPosition);
      expect(document.activeElement).toBe(headerControl);
      expect(document.querySelector(".action-error-toast")).toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
      headerControl.remove();
    }
  },
);

it("keeps a short explanation anchored when growth makes all natural content fit", async () => {
  let viewportHeight = 250;
  let resize: ResizeObserverCallback | undefined;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(120);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("result-scroll") ? viewportHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    const space = this.querySelector<HTMLDivElement>(':scope > div[aria-hidden="true"]');
    return this.classList.contains("result-scroll")
      ? Math.max(viewportHeight, 400 + (Number.parseFloat(space?.style.height ?? "0") || 0))
      : 0;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const offset = this.closest(".result-scroll")?.scrollTop ?? 0;
    const top =
      this.tagName === "SUMMARY"
        ? 150 - offset
        : this.tagName === "LI"
          ? 200 - offset
          : this.getAttribute("aria-hidden") === "true" && this.tagName === "DIV"
            ? 400 - offset
            : this.tagName === "TEXTAREA"
              ? -offset
              : 0;
    const height = this.tagName === "SUMMARY" ? 20 : this.tagName === "LI" ? 100 : 0;
    return {
      top,
      bottom: top + height,
      left: 0,
      right: 320,
      x: 0,
      y: top,
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
          improved="Short output"
          changes={["Explanation"]}
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
    const container = host.querySelector<HTMLElement>(".result-scroll")!;
    let scrollOffset = 0;
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      get: () => scrollOffset,
      set: (value: number) => {
        scrollOffset = Math.max(0, Math.min(value, container.scrollHeight - viewportHeight));
      },
    });
    host.querySelector("details")!.open = true;
    container.scrollTop = 150;
    container.dispatchEvent(new Event("scroll"));
    expect(host.querySelector("li")!.getBoundingClientRect().top).toBe(50);
    viewportHeight = 650;
    container.scrollTop = 0;
    container.dispatchEvent(new Event("scroll"));
    await act(async () => {
      resize?.([], {} as ResizeObserver);
    });
    expect(host.querySelector("li")!.getBoundingClientRect().top).toBe(50);
    expect(container.scrollTop).toBe(150);
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
});
