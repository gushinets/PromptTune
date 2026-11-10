import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./App.css";
import "./layout-toggle.css";
import { I18nProvider } from "@shared/i18n";

import { takeSelection } from "@shared/selection";

async function main() {
  const initialSelection = await takeSelection(window.location.search);
  const root = document.getElementById("root")!;
  createRoot(root).render(
    <I18nProvider>
      <App viewMode="popup" initialSelection={initialSelection} />
    </I18nProvider>,
  );
}

void main();
