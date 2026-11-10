import { useT } from "@shared/i18n";

/** A private selection never mounts the optimizer or enters its persistent draft flow. */
export function PrivateSelectionNotice() {
  const t = useT();
  return (
    <main className="mode-onboarding" role="alert">
      <h3>{t.appName}</h3>
      <p>{t.privateSelectionUnavailable}</p>
      <button className="btn-secondary" onClick={() => window.close()}>
        {t.ariaLabelDismiss}
      </button>
    </main>
  );
}
