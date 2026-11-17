import { createRoot } from "react-dom/client";
import { I18nProvider } from "@shared/i18n";
import { SidepanelApp } from "./SidepanelApp";
import "../popup/App.css";

const root = document.getElementById("root")!;
createRoot(root).render(
  <I18nProvider>
    <SidepanelApp />
  </I18nProvider>,
);
