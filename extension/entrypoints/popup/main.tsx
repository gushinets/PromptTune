import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PrivateSelectionNotice } from "./PrivateSelectionNotice";
import "./App.css";
import "./layout-toggle.css";
import { I18nProvider } from "@shared/i18n";

import { loadSelectionSession } from "@shared/selection";

async function main() {
  const root = document.getElementById("root")!;
  if (new URLSearchParams(window.location.search).get("privateSelectionBlocked") === "1") {
    createRoot(root).render(
      <I18nProvider>
        <PrivateSelectionNotice />
      </I18nProvider>,
    );
    return;
  }
  const selectionSession = await loadSelectionSession(window.location.search);
  createRoot(root).render(
    <I18nProvider>
      <App viewMode="popup" {...selectionSession} />
    </I18nProvider>,
  );
}

void main();
