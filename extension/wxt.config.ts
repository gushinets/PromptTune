import { defineConfig } from "wxt";
import path from "node:path";

export default defineConfig({
  srcDir: ".",
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    resolve: {
      alias: {
        "@shared": path.resolve(__dirname, "shared"),
        "@adapters": path.resolve(__dirname, "adapters"),
      },
    },
  }),
  manifest: {
    name: "PromptTune",
    description: "Improve your AI prompts with one click",
    version: "0.1.0",
    icons: {
      "16": "icon-16.png",
      "32": "icon-32.png",
      "48": "icon-48.png",
      "128": "icon-128.png",
    },
    permissions: ["storage", "tabs", "activeTab", "scripting", "commands"],
    host_permissions: [
      "https://api.anytoolai.store/*",
      "https://chatgpt.com/*",
      "https://claude.ai/*",
      "https://www.perplexity.ai/*",
      "https://groq.com/*",
      "https://chat.deepseek.com/*",
    ],
    commands: {
      "improve-active-field": {
        suggested_key: {
          default: "Ctrl+Shift+I",
          mac: "Command+Shift+I",
        },
        description: "Improve the active input field",
      },
    },
  },
  webExt: {
    startUrls: ["https://chatgpt.com"],
  },
});
