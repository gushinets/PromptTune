import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { locale, useT } from "@shared/i18n";
import { goalLabel } from "@shared/goal-options";
import { CHANGE_LINE_TRANSLATIONS_RU } from "@shared/change-translations";
import type { ImproveGoal } from "@shared/types";
import { ErrorToast } from "./ErrorToast";

interface ResultProps {
  improved: string;
  changes: string[];
  goal: ImproveGoal;
  hidden: boolean;
  actions: ReactNode;
  onEdit: () => void;
  onNew: () => void;
  lengthWarning?: string;
  disabled?: boolean;
}
export function OptimizerResult({
  improved,
  changes,
  goal,
  hidden,
  actions,
  onEdit,
  onNew,
  lengthWarning,
  disabled = false,
}: ResultProps) {
  const t = useT();
  const outputId = useId();
  const output = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const readingSpace = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const localized = useMemo(
    () =>
      changes.map((line) => (locale === "ru" ? (CHANGE_LINE_TRANSLATIONS_RU[line] ?? line) : line)),
    [changes],
  );
  useEffect(() => {
    if (hidden || !output.current || !scroll.current) return;
    const field = output.current;
    const container = scroll.current;
    if (readingSpace.current) readingSpace.current.style.height = "0px";
    const pixels = (value: string) => Number.parseFloat(value) || 0;
    let previousFeedback: Element | null = null;
    let previousFeedbackText: string | null = null;
    let viewportWidth = container.clientWidth;
    let viewportHeight = container.clientHeight;
    let readingAnchor: { element: Element; offset: number } | null = null;
    const captureReadingAnchor = () => {
      if (!details.current?.open) return null;
      const visibleTop = container.getBoundingClientRect().top + container.clientTop;
      const visibleBottom = visibleTop + container.clientHeight;
      const element = Array.from(details.current.querySelectorAll("summary, li")).find((item) => {
        const bounds = item.getBoundingClientRect();
        return bounds.bottom > visibleTop && bounds.top < visibleBottom;
      });
      return element ? { element, offset: element.getBoundingClientRect().top - visibleTop } : null;
    };
    const rememberReadingAnchor = () => {
      // Ignore scroll events caused by a viewport resize: Chromium may have
      // already clamped scrollTop, before ResizeObserver can restore the reader.
      if (container.clientWidth === viewportWidth && container.clientHeight === viewportHeight) {
        readingAnchor = captureReadingAnchor();
        if (!readingAnchor && readingSpace.current) readingSpace.current.style.height = "0px";
      }
    };
    const resize = () => {
      const visibleTop = container.getBoundingClientRect().top + container.clientTop;
      const visibleBottom = visibleTop + container.clientHeight;
      const viewportChanged =
        container.clientWidth !== viewportWidth || container.clientHeight !== viewportHeight;
      const anchor =
        details.current?.open && viewportChanged && readingAnchor?.element.isConnected
          ? readingAnchor
          : captureReadingAnchor();
      // Keep the actions beside the visible text. Explanations use the shared
      // scroller, as in the mockup, without taking height away from the result.
      let reserved = 0;
      for (let sibling = field.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
        if (sibling.tagName === "DETAILS" || sibling === readingSpace.current) continue;
        const style = getComputedStyle(sibling);
        reserved +=
          sibling.getBoundingClientRect().height +
          pixels(style.marginTop) +
          pixels(style.marginBottom);
      }
      const top =
        field.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        container.clientTop;
      const available =
        container.clientHeight - top - reserved - pixels(getComputedStyle(container).paddingBottom);
      const style = getComputedStyle(field);
      const borders = pixels(style.borderTopWidth) + pixels(style.borderBottomWidth);
      const scrollTop = container.scrollTop;
      field.style.height = "auto";
      field.style.height = `${Math.max(120, Math.min(available, field.scrollHeight + borders))}px`;
      container.scrollTop = scrollTop;
      if (anchor) {
        const targetScrollTop =
          container.scrollTop +
          anchor.element.getBoundingClientRect().top -
          visibleTop -
          anchor.offset;
        if (readingSpace.current) {
          // scrollHeight is never smaller than clientHeight. Measure the
          // content bottom directly so short explanations retain their offset too.
          const naturalMaximum =
            readingSpace.current.getBoundingClientRect().top -
            container.getBoundingClientRect().top +
            container.scrollTop -
            container.clientTop +
            pixels(getComputedStyle(container).paddingBottom) -
            container.clientHeight;
          // Growing the viewport can otherwise make the saved reading offset
          // unreachable, even after the textarea reaches its final height.
          readingSpace.current.style.height = `${Math.ceil(Math.max(0, targetScrollTop - naturalMaximum))}px`;
        }
        container.scrollTop = targetScrollTop;
      }
      const feedback = container.querySelector('.action-feedback[role="alert"]');
      const focused = document.activeElement;
      const focusedAction =
        focused instanceof HTMLElement &&
        container.contains(focused) &&
        focused.closest(".action-bar")
          ? focused
          : null;
      if (
        feedback &&
        (feedback !== previousFeedback ||
          feedback.textContent !== previousFeedbackText ||
          (viewportChanged && focusedAction))
      ) {
        const bounds = feedback.getBoundingClientRect();
        const focusBounds = focusedAction?.getBoundingClientRect();
        const revealTop = Math.min(bounds.top, focusBounds ? focusBounds.top - 5 : bounds.top);
        const revealBottom = Math.max(
          bounds.bottom,
          focusBounds ? focusBounds.bottom + 5 : bounds.bottom,
        );
        if (focusBounds && revealBottom - revealTop > container.clientHeight) {
          // A short viewport cannot show both. Keep keyboard focus visible and
          // show the error above the scroller without changing its layout.
          setActionNotice(feedback.textContent);
          if (focusBounds.bottom + 5 > visibleBottom)
            container.scrollTop += focusBounds.bottom + 5 - visibleBottom;
          else if (focusBounds.top - 5 < visibleTop)
            container.scrollTop += focusBounds.top - 5 - visibleTop;
        } else {
          setActionNotice(null);
          if (revealBottom > visibleBottom) container.scrollTop += revealBottom - visibleBottom;
          else if (revealTop < visibleTop) container.scrollTop += revealTop - visibleTop;
        }
      }
      if (!feedback) setActionNotice(null);
      previousFeedback = feedback;
      previousFeedbackText = feedback?.textContent ?? null;
      viewportWidth = container.clientWidth;
      viewportHeight = container.clientHeight;
      readingAnchor = captureReadingAnchor();
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    container.addEventListener("scroll", rememberReadingAnchor, { passive: true });
    const observer = new ResizeObserver(() => {
      resize();
    });
    const mutations = new MutationObserver(resize);
    observer.observe(container);
    for (let sibling = field.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      if (sibling.tagName !== "DETAILS" && sibling !== readingSpace.current) {
        observer.observe(sibling);
        mutations.observe(sibling, { childList: true, characterData: true, subtree: true });
      }
    }
    return () => {
      observer.disconnect();
      mutations.disconnect();
      container.removeEventListener("scroll", rememberReadingAnchor);
    };
  }, [improved, hidden, lengthWarning, localized.length]);
  useEffect(() => {
    if (expanded) details.current?.scrollIntoView?.({ block: "nearest" });
    else if (readingSpace.current) readingSpace.current.style.height = "0px";
  }, [expanded]);
  useEffect(() => {
    if (hidden || !actionNotice) return;
    const dismissOnFocusLeave = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        (target.closest(".action-error-toast") ||
          scroll.current?.querySelector(".action-bar")?.contains(target))
      )
        return;
      setActionNotice(null);
    };
    document.addEventListener("focusin", dismissOnFocusLeave);
    return () => document.removeEventListener("focusin", dismissOnFocusLeave);
  }, [actionNotice, hidden]);
  return (
    <section className="result-screen" hidden={hidden}>
      <div className="result-meta">
        <span className="goal-badge">{goalLabel(t, goal)}</span>
      </div>
      <div className="result-scroll" ref={scroll}>
        <label htmlFor={outputId} className="section-label">
          {t.labelImprovedPrompt}
        </label>
        <textarea
          id={outputId}
          className="prompt-textarea improved-textarea"
          ref={output}
          readOnly
          value={improved}
        />
        {lengthWarning && (
          <p className="prompt-length-error" role="alert">
            {lengthWarning}
          </p>
        )}
        {actions}
        {localized.length > 0 && (
          <details
            ref={details}
            className="improvements-details"
            onToggle={(event) => setExpanded(event.currentTarget.open)}
          >
            <summary>
              <span>
                {t.whyItChanged}
                <span className="change-count">{localized.length}</span>
              </span>
              <span className="changes-chevron" aria-hidden="true">
                ▾
              </span>
            </summary>
            <ol className="improvements-list">
              {localized.map((line, index) => (
                <li key={`${index}-${line}`}>
                  <span className="change-number" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p>{line}</p>
                </li>
              ))}
            </ol>
          </details>
        )}
        <div ref={readingSpace} aria-hidden="true" />
      </div>
      <div className="result-navigation">
        <button className="btn-edit" disabled={disabled} onClick={onEdit}>
          {t.btnEditOriginal}
        </button>
        <button className="btn-new" disabled={disabled} onClick={onNew}>
          {t.btnNew}
        </button>
      </div>
      {!hidden &&
        actionNotice &&
        createPortal(
          <div className="action-error-toast">
            <ErrorToast
              announce={false}
              error={{ type: "generic", message: actionNotice }}
              onDismiss={() => setActionNotice(null)}
            />
          </div>,
          document.body,
        )}
    </section>
  );
}
