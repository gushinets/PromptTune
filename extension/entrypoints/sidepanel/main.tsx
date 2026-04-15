import { createRoot } from "react-dom/client";
import { I18nProvider } from "@shared/i18n";
import { App } from "../popup/App";
import "../popup/App.css";

const root = document.getElementById("root")!;
createRoot(root).render(
  <I18nProvider>
    <App viewMode="sidepanel" />
  </I18nProvider>,
);
