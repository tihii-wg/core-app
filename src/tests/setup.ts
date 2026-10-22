import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import i18n from "../i18n";

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
