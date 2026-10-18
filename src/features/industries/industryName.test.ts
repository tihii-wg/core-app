import { describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { industryName } from "./industryName";

describe("industryName", () => {
  it("translates known industry slugs in the active UI language", async () => {
    await i18n.changeLanguage("en");
    expect(industryName({ name: "Auto Repair & Service", slug: "auto_repair" })).toBe("Auto Repair & Service");

    await i18n.changeLanguage("ru");
    expect(industryName({ name: "Auto Repair & Service", slug: "auto_repair" })).not.toBe("Auto Repair & Service");
    expect(industryName({ name: "Auto Repair & Service", slug: "auto_repair" }).length).toBeGreaterThan(0);

    await i18n.changeLanguage("en");
  });

  it("falls back to the database name for unknown slugs", () => {
    expect(industryName({ name: "Custom Trade", slug: "custom_trade" })).toBe("Custom Trade");
  });
});
