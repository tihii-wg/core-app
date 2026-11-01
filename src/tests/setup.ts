import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { beforeEach } from "vitest";
import i18n from "../i18n";

// Full-suite parallel load routinely exceeds the 1s Testing Library default for findBy/waitFor.
configure({ asyncUtilTimeout: 8_000 });

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

// jsdom has no ResizeObserver; several panels (Radix, charts) observe size.
// Same stub the app harness installs (src/tests/appHarness.tsx).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
