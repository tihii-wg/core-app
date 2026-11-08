import { describe, expect, it } from "vitest";
import { industryProfile } from "../industries/industryProfile";
import {
  combineDateTimeLocal,
  emptyOrderIndustryFormFields,
  hasVisibleIndustryOrderFields,
  isInstallationBeforeMeasurement,
  orderAssetSecondaryLine,
  orderIndustryFieldsToApi,
  orderIndustryFormFieldsFromOrder,
  splitDateTimeLocal,
} from "./industryOrderFieldHelpers";

describe("orderIndustryFields helpers", () => {
  it("splits and combines local date/time round-trip", () => {
    const iso = combineDateTimeLocal("2026-11-10", "09:30");
    expect(iso).toBeTruthy();
    const parts = splitDateTimeLocal(iso);
    expect(parts.date).toBe("2026-11-10");
    expect(parts.time).toBe("09:30");
  });

  it("saves empty strings as null", () => {
    expect(
      orderIndustryFieldsToApi({
        ...emptyOrderIndustryFormFields(),
        deviceSerial: "  ",
        siteAddress: "  Main St  ",
      }),
    ).toEqual({
      deviceSerial: null,
      deviceImei: null,
      deviceCondition: null,
      deviceCompleteness: null,
      devicePasscode: null,
      siteAddress: "Main St",
      productDimensions: null,
      measurementAt: null,
      installationAt: null,
    });
  });

  it("detects installation before measurement", () => {
    expect(isInstallationBeforeMeasurement("2026-11-20T10:00:00.000Z", "2026-11-10T10:00:00.000Z")).toBe(true);
    expect(isInstallationBeforeMeasurement("2026-11-10T10:00:00.000Z", "2026-11-20T10:00:00.000Z")).toBe(false);
    expect(isInstallationBeforeMeasurement(null, "2026-11-20T10:00:00.000Z")).toBe(false);
  });

  it("maps order → form fields including timestamps", () => {
    const form = orderIndustryFormFieldsFromOrder({
      deviceSerial: "SN-1",
      deviceImei: "",
      deviceCondition: "",
      deviceCompleteness: "",
      devicePasscode: "",
      siteAddress: "",
      productDimensions: "",
      measurementAt: "2026-11-10T09:30:00.000Z",
      installationAt: null,
    });
    expect(form.deviceSerial).toBe("SN-1");
    expect(form.measurementDate).toBe(splitDateTimeLocal("2026-11-10T09:30:00.000Z").date);
    expect(form.measurementTime).toBe(splitDateTimeLocal("2026-11-10T09:30:00.000Z").time);
    expect(form.installationDate).toBe("");
  });
});

describe("field visibility via assetKind / orderFieldBlocks", () => {
  it("shows device intake for device industries and site/project extras by kind", () => {
    expect(hasVisibleIndustryOrderFields(industryProfile("phone_electronics_repair").orderFieldBlocks)).toBe(true);
    expect(industryProfile("phone_electronics_repair").orderFieldBlocks.deviceImei).toBe(true);
    expect(industryProfile("computer_repair").orderFieldBlocks.deviceImei).toBe(false);
    expect(hasVisibleIndustryOrderFields(industryProfile("auto_repair").orderFieldBlocks)).toBe(false);
    expect(hasVisibleIndustryOrderFields(industryProfile("other").orderFieldBlocks)).toBe(false);
    expect(industryProfile("home_services").orderFieldBlocks.siteAddress).toBe(true);
    expect(industryProfile("furniture_manufacturing").orderFieldBlocks.measurementAt).toBe(true);
  });

  it("picks the secondary card line from blocks", () => {
    const order = {
      carNumber: "ABC 123",
      vin: "VIN",
      deviceSerial: "SN-9",
      siteAddress: "Site 1",
    };
    expect(orderAssetSecondaryLine(order, industryProfile("auto_repair").orderFieldBlocks)).toBe("ABC 123");
    expect(orderAssetSecondaryLine(order, industryProfile("computer_repair").orderFieldBlocks)).toBe("SN-9");
    expect(orderAssetSecondaryLine(order, industryProfile("furniture_manufacturing").orderFieldBlocks)).toBe("Site 1");
  });
});
