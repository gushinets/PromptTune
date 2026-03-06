import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: ".",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "PromptTune",
    description: "Improve your AI prompts with one click",
    version: "0.1.0",
    permissions: ["storage", "tabs", "activeTab", "scripting", "commands"],
    host_permissions: [
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
  runner: {
    startUrls: ["https://chatgpt.com"],
  },
});
