import type { Plugin } from "vite";
import { applyLegacyChromiumCssFixes } from "./src/styles/legacyChromiumColors";

/**
 * Post-process Tailwind CSS for Chromium ≤109 (last Chrome / Edge on Windows 7):
 * - Replace oklch() palette theme vars with hex
 * - Add `@supports not (color-mix)` rgba overrides for opacity utilities
 *
 * Modern browsers keep Tailwind's color-mix / oklch path unchanged.
 */
export function legacyChromiumColorsPlugin(): Plugin {
  return {
    name: "legacy-chromium-colors",
    enforce: "post",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const piece of Object.values(bundle)) {
        if (piece.type !== "asset" || !piece.fileName.endsWith(".css")) continue;
        const source = typeof piece.source === "string" ? piece.source : Buffer.from(piece.source).toString("utf8");
        if (!source.includes("color-mix(") && !source.includes("oklch(")) continue;
        piece.source = applyLegacyChromiumCssFixes(source);
      }
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        // No HTML changes; CSS is rewritten in generateBundle for production builds.
        return html;
      },
    },
  };
}
