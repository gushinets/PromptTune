import browser from "webextension-polyfill";

const SITES = [
  { id: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com", icon: "🤖" },
  { id: "claude", label: "Claude", url: "https://claude.ai", icon: "🟠" },
  { id: "perplexity", label: "Perplexity", url: "https://www.perplexity.ai", icon: "🔍" },
  { id: "groq", label: "Groq", url: "https://groq.com", icon: "⚡" },
  { id: "deepseek", label: "Deepseek", url: "https://chat.deepseek.com", icon: "🐋" },
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
    <div className="site-icons">
      {SITES.map((site) => (
        <button
          key={site.id}
          className="site-icon-btn"
          title={`Open & Paste in ${site.label}`}
          disabled={disabled}
          onClick={() => handleOpenAndPaste(site.url)}
        >
          {site.icon}
        </button>
      ))}
    </div>
  );
}
