import { describe, expect, it } from "vitest";
import { industryCapabilitiesFromProfile } from "./industryCapabilities";
import {
  industryOpenStatusSeeds,
  industryProfile,
  KNOWN_INDUSTRY_SLUGS,
} from "./industryProfile";
import { industryWorkflow } from "./industryWorkflow";

describe("industryProfile registry", () => {
  it("defines a complete profile for every known slug", () => {
    for (const slug of KNOWN_INDUSTRY_SLUGS) {
      const profile = industryProfile(slug);
      expect(profile.slug).toBe(slug);
      expect(profile.assetKind).toBeTruthy();
      expect(profile.copyPack).toBeTruthy();
      expect(profile.termsPack).toBeTruthy();
      expect(profile.orderFields.device).toBeTruthy();
      expect(profile.orderFieldBlocks).toBeTruthy();
      expect(profile.serviceCategories.length).toBeGreaterThan(0);
      expect(profile.defaultStatuses.length).toBeGreaterThan(0);
      expect(profile.documents.length).toBeGreaterThan(0);
      expect(profile.warranty.defaultValue).toBeGreaterThan(0);
      expect(profile.demoPack).toBeTruthy();
    }
  });

  it("maps unknown or missing slugs to other", () => {
    expect(industryProfile(null).slug).toBe("other");
    expect(industryProfile(undefined).slug).toBe("other");
    expect(industryProfile("space_travel").slug).toBe("other");
    expect(industryProfile("space_travel").assetKind).toBe("none");
  });

  it("enables mileage warranty only for auto_repair", () => {
    for (const slug of KNOWN_INDUSTRY_SLUGS) {
      const profile = industryProfile(slug);
      expect(profile.warranty.mileage).toBe(slug === "auto_repair");
    }
  });

  it("defines furniture_manufacturing as a project industry with 9 open statuses and 5 documents", () => {
    const furniture = industryProfile("furniture_manufacturing");
    expect(furniture.assetKind).toBe("project");
    expect(furniture.orderFieldBlocks.descriptionAsProductNotes).toBe(true);
    expect(furniture.navigation.materialsWarehouseLabel).toBe(true);
    expect(furniture.navigation.clientVehicles).toBe(false);
    expect(industryOpenStatusSeeds(furniture)).toHaveLength(9);
    expect(furniture.defaultStatuses.some((s) => s.semanticAction === "cancel")).toBe(true);
    expect(furniture.documents).toHaveLength(5);
    expect(furniture.suggestedCatalogCategoryKeys).toHaveLength(7);
    expect(furniture.warranty).toEqual({ unit: "months", defaultValue: 12, mileage: false });
  });

  it("keeps client vehicles only for auto_repair via capabilities", () => {
    expect(industryCapabilitiesFromProfile(industryProfile("auto_repair")).clientVehicles).toBe(true);
    expect(industryCapabilitiesFromProfile(industryProfile("furniture_manufacturing")).clientVehicles).toBe(false);
    expect(industryCapabilitiesFromProfile(industryProfile("computer_repair")).automotiveOrderAssets).toBe(false);
  });

  it("exposes furniture through industryWorkflow without automotive fields", () => {
    const workflow = industryWorkflow("furniture_manufacturing");
    expect(workflow.copyPack).toBe("furniture_manufacturing");
    expect(workflow.orderFields.vin.visible).toBe(false);
    expect(workflow.orderFields.carNumber.visible).toBe(false);
    expect(workflow.orderFields.device.visible).toBe(true);
  });

  it("exposes device serial / intake fields and IMEI only for phones", () => {
    const phone = industryProfile("phone_electronics_repair");
    expect(phone.orderFields.vin.visible).toBe(false);
    expect(phone.orderFieldBlocks.deviceFields).toBe(true);
    expect(phone.orderFieldBlocks.deviceSerial).toBe(true);
    expect(phone.orderFieldBlocks.deviceImei).toBe(true);
    expect(phone.orderFieldBlocks.deviceCondition).toBe(true);
    expect(phone.orderFieldBlocks.devicePasscode).toBe(true);

    const computer = industryProfile("computer_repair");
    expect(computer.orderFieldBlocks.deviceSerial).toBe(true);
    expect(computer.orderFieldBlocks.deviceImei).toBe(false);

    const site = industryProfile("electrical_services");
    expect(site.orderFieldBlocks.siteAddress).toBe(true);
    expect(site.orderFieldBlocks.deviceSerial).toBe(false);
    expect(site.orderFieldBlocks.measurementAt).toBe(false);

    const furniture = industryProfile("furniture_manufacturing");
    expect(furniture.orderFieldBlocks.siteAddress).toBe(true);
    expect(furniture.orderFieldBlocks.productDimensions).toBe(true);
    expect(furniture.orderFieldBlocks.measurementAt).toBe(true);
    expect(furniture.orderFieldBlocks.installationAt).toBe(true);

    const auto = industryProfile("auto_repair");
    expect(auto.orderFieldBlocks.deviceSerial).toBe(false);
    expect(auto.orderFieldBlocks.siteAddress).toBe(false);
  });
});
