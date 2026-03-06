import type { SiteAdapter } from "./types";
import { fallbackAdapter } from "./fallback";
import { chatgptAdapter } from "./chatgpt";
import { claudeAdapter } from "./claude";
import { perplexityAdapter } from "./perplexity";
import { groqAdapter } from "./groq";
import { deepseekAdapter } from "./deepseek";

const adapters: SiteAdapter[] = [
  chatgptAdapter,
  claudeAdapter,
  perplexityAdapter,
  groqAdapter,
  deepseekAdapter,
];

export function getAdapter(hostname: string): SiteAdapter {
  return adapters.find((a) => a.match(hostname)) ?? fallbackAdapter;
}
