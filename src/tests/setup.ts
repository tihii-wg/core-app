import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import i18n from "../i18n";

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
