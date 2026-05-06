import { describe, expect, it } from "vitest";
import { dashboardPresets } from "./presets";

function expectKeywords(title: string, keywords: string[]) {
  const normalized = title.toLowerCase();

  for (const keyword of keywords) {
    expect(normalized).toContain(keyword);
  }
}

describe("dashboardPresets", () => {
  it("includes auto service and electronics repair starter dashboards", () => {
    expectKeywords(dashboardPresets.auto_service.title, ["авто", "сервис"]);
    expectKeywords(dashboardPresets.electronics_repair.title, ["ремонт", "электроник"]);
  });
});
