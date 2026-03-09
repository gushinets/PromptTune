import browser from "webextension-polyfill";

function ChatGPTIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.28 9.82a5.99 5.99 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.99 5.99 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.99 5.99 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07zM13.26 22.43a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.8.8 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.5zM3.6 18.3a4.47 4.47 0 0 1-.54-3.01l.14.09 4.78 2.75a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 19.95a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.49 4.49 0 0 1 2.37-1.97V11.6a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.87zm16.6 3.86-5.84-3.39 2.02-1.17a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.68a.79.79 0 0 0-.4-.66zm2.01-3.02-.14-.09-4.78-2.78a.78.78 0 0 0-.78 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.31 12.86 6.29 11.7a.08.08 0 0 1-.04-.06V6.08a4.5 4.5 0 0 1 7.38-3.46l-.14.08-4.78 2.76a.8.8 0 0 0-.39.68zm1.1-2.37 2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5z" />
    </svg>
  );
}

function ClaudeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4L6 20" />
      <path d="M12 4l6 16" />
      <path d="M8.5 14h7" />
    </svg>
  );
}

function PerplexityIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <path d="M12 2v20M2 12h20M5.64 5.64l12.73 12.73M18.36 5.64 5.64 18.36" />
    </svg>
  );
}

function GroqIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="10" r="5" />
      <path d="M16 10v8a3 3 0 0 1-3 3h-1" />
    </svg>
  );
}

function DeepSeekIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 4h3a8 8 0 0 1 0 16H7V4z" />
      <circle cx="13" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

const SITES = [
  { id: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com", Icon: ChatGPTIcon },
  { id: "claude", label: "Claude", url: "https://claude.ai", Icon: ClaudeIcon },
  { id: "perplexity", label: "Perplexity", url: "https://www.perplexity.ai", Icon: PerplexityIcon },
  { id: "groq", label: "Groq", url: "https://groq.com", Icon: GroqIcon },
  { id: "deepseek", label: "Deepseek", url: "https://chat.deepseek.com", Icon: DeepSeekIcon },
] as const;

interface SiteIconsProps {
  improved: string;
  disabled: boolean;
}

export function SiteIcons({ improved, disabled }: SiteIconsProps) {
  const handleOpenAndPaste = async (url: string) => {
    await browser.runtime.sendMessage({
      type: "OPEN_AND_PASTE",
      payload: { url, text: improved },
    });
  };

  return (
    <div className="site-icons-section">
      <span className="site-icons-label">Open &amp; Paste</span>
      <div className="site-icons">
        {SITES.map((site) => (
          <div key={site.id} className="site-icon-wrapper">
            <button
              className={`site-icon-btn ${site.id}`}
              title={`Open & Paste in ${site.label}`}
              disabled={disabled}
              onClick={() => handleOpenAndPaste(site.url)}
            >
              <site.Icon />
            </button>
            <span className="site-icon-label">{site.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
