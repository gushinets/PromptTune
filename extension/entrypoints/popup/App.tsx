import { useState } from "react";
import { PromptForm } from "./components/PromptForm";
import { ActionBar } from "./components/ActionBar";
import { SiteIcons } from "./components/SiteIcons";

export function App() {
  const [original, setOriginal] = useState("");
  const [improved, setImproved] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="popup-container">
      <h1 className="popup-title">PromptTune</h1>
      <PromptForm
        original={original}
        improved={improved}
        loading={loading}
        error={error}
        onOriginalChange={setOriginal}
        onImprove={() => {
          // TODO: wire up background IMPROVE_REQUEST
          setLoading(true);
          setError(null);
        }}
      />
      <ActionBar
        improved={improved}
        disabled={!improved}
        onSave={() => {
          // TODO: save to library
        }}
      />
      <SiteIcons
        improved={improved}
        disabled={!improved}
      />
    </div>
  );
}
