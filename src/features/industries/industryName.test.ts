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

  it("translates furniture_manufacturing", async () => {
    await i18n.changeLanguage("en");
    expect(industryName({ name: "Custom Furniture Manufacturing", slug: "furniture_manufacturing" })).toBe(
      "Custom Furniture Manufacturing",
    );
    await i18n.changeLanguage("ru");
    expect(industryName({ name: "Custom Furniture Manufacturing", slug: "furniture_manufacturing" })).toContain(
      "мебели",
    );
    await i18n.changeLanguage("en");
  });
});

