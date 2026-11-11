import { beforeEach, describe, expect, it } from "vitest";
import {
  isOrderDetailTab,
  orderDetailItemsCount,
  peekOrderDetailTab,
  readOrderDetailTabOnOpen,
  resetOrderDetailTabSession,
  usesWorksAndMaterialsTabLabel,
  writeOrderDetailTab,
} from "./orderDetailTabs";

describe("orderDetailTabs session", () => {
  beforeEach(() => {
    resetOrderDetailTabSession();
  });

  it("starts on info the first time the sheet opens", () => {
    expect(readOrderDetailTabOnOpen()).toBe("info");
  });

  it("remembers the selected tab across subsequent opens and order switches", () => {
    readOrderDetailTabOnOpen();
    writeOrderDetailTab("payments");
    expect(peekOrderDetailTab()).toBe("payments");
    expect(readOrderDetailTabOnOpen()).toBe("payments");
  });
});

describe("orderDetailTabs helpers", () => {
  it("validates tab ids", () => {
    expect(isOrderDetailTab("info")).toBe(true);
    expect(isOrderDetailTab("history")).toBe(true);
    expect(isOrderDetailTab("nope")).toBe(false);
  });

  it("uses works/materials wording for furniture and field-service industries", () => {
    expect(usesWorksAndMaterialsTabLabel("furniture_manufacturing")).toBe(true);
    expect(usesWorksAndMaterialsTabLabel("home_services")).toBe(true);
    expect(usesWorksAndMaterialsTabLabel("auto_repair")).toBe(false);
  });

  it("sums service and material lines for the items badge", () => {
    expect(orderDetailItemsCount(2, 3)).toBe(5);
    expect(orderDetailItemsCount(0, 0)).toBe(0);
  });
});
