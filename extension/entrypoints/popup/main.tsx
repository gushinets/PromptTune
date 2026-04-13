import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./App.css";
import "./layout-toggle.css";
import { I18nProvider } from "@shared/i18n";

const root = document.getElementById("root")!;
createRoot(root).render(
  <I18nProvider>
    <App viewMode="popup" />
  </I18nProvider>,
);
