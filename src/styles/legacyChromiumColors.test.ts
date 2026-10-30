import { describe, expect, it } from "vitest";
import {
  appendLegacyColorMixFallbacks,
  applyLegacyChromiumCssFixes,
  findColorMixFallbacks,
  hexToRgba,
  replaceOklchPaletteVars,
} from "./legacyChromiumColors";

describe("legacyChromiumColors", () => {
  it("converts hex + percent into rgba for Chrome 109 soft fills", () => {
    expect(hexToRgba("#1a6de0", 10)).toBe("rgba(26, 109, 224, 0.1)");
    expect(hexToRgba("#d92d20", 15)).toBe("rgba(217, 45, 32, 0.15)");
    expect(hexToRgba("#fff", 50)).toBe("rgba(255, 255, 255, 0.5)");
  });

  it("detects Tailwind solid-token color-mix fallbacks", () => {
    const css =
      ".bg-primary\\/10{background-color:var(--primary)}" +
      "@supports (color:color-mix(in lab, red, red)){.bg-primary\\/10{background-color:color-mix(in oklab, var(--primary) 10%, transparent)}}" +
      ".focus-visible\\:ring-ring\\/35:focus-visible{--tw-ring-color:var(--ring)}" +
      "@supports (color:color-mix(in lab, red, red)){.focus-visible\\:ring-ring\\/35:focus-visible{--tw-ring-color:color-mix(in oklab, var(--ring) 35%, transparent)}}";

    expect(findColorMixFallbacks(css)).toEqual([
      { selector: "bg-primary\\/10", property: "background-color", token: "--primary", percent: 10 },
      {
        selector: "focus-visible\\:ring-ring\\/35:focus-visible",
        property: "--tw-ring-color",
        token: "--ring",
        percent: 35,
      },
    ]);
  });

  it("appends @supports not overrides with light and dark rgba values", () => {
    const css =
      ".bg-destructive\\/10{background-color:var(--destructive)}" +
      "@supports (color:color-mix(in lab, red, red)){.bg-destructive\\/10{background-color:color-mix(in oklab, var(--destructive) 10%, transparent)}}";

    const next = appendLegacyColorMixFallbacks(css);
    expect(next).toContain("@supports not (color: color-mix(in lab, red, red))");
    expect(next).toContain(".bg-destructive\\/10{background-color:rgba(217, 45, 32, 0.1)}");
    expect(next).toContain(".dark .bg-destructive\\/10{background-color:rgba(240, 84, 74, 0.1)}");
    // Modern path unchanged.
    expect(next).toContain("@supports (color:color-mix(in lab, red, red)){.bg-destructive\\/10{background-color:color-mix(in oklab, var(--destructive) 10%, transparent)}}");
  });

  it("replaces oklch palette theme variables with hex for Lucide currentColor icons", () => {
    const css = ":root{--color-amber-600:oklch(66.6% .179 58.318);--color-emerald-600:oklch(59.6% .145 163.225)}";
    expect(replaceOklchPaletteVars(css)).toBe(
      ":root{--color-amber-600:#d97706;--color-emerald-600:#059669}",
    );
  });

  it("applies both oklch and color-mix legacy fixes together", () => {
    const css =
      ":root{--color-amber-500:oklch(76.9% .188 70.08)}" +
      ".bg-primary\\/10{background-color:var(--primary)}" +
      "@supports (color:color-mix(in lab, red, red)){.bg-primary\\/10{background-color:color-mix(in oklab, var(--primary) 10%, transparent)}}";

    const next = applyLegacyChromiumCssFixes(css);
    expect(next).toContain("--color-amber-500:#f59e0b");
    expect(next).not.toContain("oklch(");
    expect(next).toContain(".bg-primary\\/10{background-color:rgba(26, 109, 224, 0.1)}");
  });
});
