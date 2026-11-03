import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("highlights the over-limit counter and guidance with the defined red token", () => {
  const stylesheet = document.createElement("style");
  stylesheet.textContent = readFileSync(resolve(__dirname, "../entrypoints/popup/App.css"), "utf8");
  document.head.appendChild(stylesheet);
  const warning = document.createElement("div");
  warning.className = "prompt-length";
  warning.innerHTML =
    '<span class="prompt-length-counter">30 001 / 30 000</span><p class="prompt-length-error">Shorten the text.</p>';
  document.body.appendChild(warning);
  try {
    expect(getComputedStyle(warning).color).toBe("var(--txt2)");
    warning.classList.add("is-over-limit");
    expect(getComputedStyle(warning).color).toBe("var(--red)");
    expect(getComputedStyle(warning.querySelector("span")!).color).toBe("var(--red)");
    expect(getComputedStyle(warning.querySelector("p")!).color).toBe("var(--red)");
    const red = getComputedStyle(document.documentElement).getPropertyValue("--red").trim();
    const probe = document.createElement("span");
    probe.style.color = red;
    expect(probe.style.color).not.toBe("");
  } finally {
    warning.remove();
    stylesheet.remove();
  }
});
