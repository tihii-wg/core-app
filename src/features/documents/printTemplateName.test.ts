import { beforeEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import {
  DOCUMENT_STYLE_NAME_KEY,
  displayPrintTemplateName,
  isPrintTemplateI18nKey,
  translatedDocumentStyleName,
} from "./printTemplateName";

describe("printTemplateName", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("ru");
  });

  it("detects stored i18n keys for print templates", () => {
    expect(isPrintTemplateI18nKey(DOCUMENT_STYLE_NAME_KEY)).toBe(true);
    expect(isPrintTemplateI18nKey("My custom style")).toBe(false);
  });

  it("translates a stored documentStyle key for display", () => {
    expect(displayPrintTemplateName(DOCUMENT_STYLE_NAME_KEY, i18n.t.bind(i18n))).toBe("Стиль документов");
    expect(displayPrintTemplateName("Custom", i18n.t.bind(i18n))).toBe("Custom");
  });

  it("returns the translated document style name for inserts", () => {
    expect(translatedDocumentStyleName(i18n.t.bind(i18n))).toBe("Стиль документов");
  });
});
