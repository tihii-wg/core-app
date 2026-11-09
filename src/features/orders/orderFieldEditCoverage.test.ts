import { describe, expect, it } from "vitest";
import { industryProfile, KNOWN_INDUSTRY_SLUGS, type IndustryProfile } from "../industries/industryProfile";
import { industryWorkflow } from "../industries/industryWorkflow";
import { mergeOrderFieldConfig } from "./orderFieldConfig";
import { ORDER_EDIT_FIELDS } from "./orderEditFields";

/**
 * EditOrderForm data-edit-field keys for an industry (no custom fields).
 * Mirrors which sub-components EditOrderForm mounts for that profile.
 */
export function editOrderFormDataEditFields(profile: IndustryProfile): Set<string> {
  const keys = new Set<string>();
  const usesVehicles = Boolean(profile.navigation.clientVehicles);

  if (usesVehicles) {
    keys.add("vehicle");
    keys.add("vehicleMake");
    keys.add("vehicleModel");
    keys.add("vehicleYear");
    keys.add("vehicleVin");
    keys.add("vehicleLicensePlate");
    keys.add("vehicleInitialMileage");
    keys.add("vehicleCurrentMileage");
    keys.add("vehicleEngineDisplacement");
    keys.add("vehicleFuelType");
  } else {
    if (profile.orderFields.device.visible) keys.add("device");
    if (profile.orderFields.carNumber.visible) keys.add("carNumber");
    if (profile.orderFields.vin.visible) keys.add("vin");
  }

  const blocks = profile.orderFieldBlocks;
  if (blocks.deviceSerial) keys.add("deviceSerial");
  if (blocks.deviceImei) keys.add("deviceImei");
  if (blocks.deviceCondition) keys.add("deviceCondition");
  if (blocks.deviceCompleteness) keys.add("deviceCompleteness");
  if (blocks.devicePasscode) keys.add("devicePasscode");
  if (blocks.siteAddress) keys.add("siteAddress");
  if (blocks.productDimensions) keys.add("productDimensions");
  if (blocks.measurementAt) keys.add("measurementAt");
  if (blocks.installationAt) keys.add("installationAt");

  keys.add("services");
  keys.add("materials");
  keys.add("description");
  keys.add("assignedEmployee");
  keys.add("team");
  keys.add("deadline");

  return keys;
}

/** Registry keys that belong on the edit form (excludes client / status / total). */
export function registryEditFormKeys(profile: IndustryProfile): Set<string> {
  const { fields } = mergeOrderFieldConfig({
    profile,
    workflow: industryWorkflow(profile.slug),
    definitions: [],
  });
  const excluded = new Set(["client", "status", "total"]);
  return new Set(fields.filter((field) => !excluded.has(field.key)).map((field) => field.key));
}

describe("order field edit coverage by industry", () => {
  it.each([...KNOWN_INDUSTRY_SLUGS])(
    "registry edit keys match EditOrderForm data-edit-field keys for %s",
    (slug) => {
      const profile = industryProfile(slug);
      const registry = registryEditFormKeys(profile);
      const form = editOrderFormDataEditFields(profile);
      expect([...registry].sort()).toEqual([...form].sort());
      for (const key of form) {
        if (key.startsWith("custom:")) continue;
        expect(ORDER_EDIT_FIELDS.includes(key as (typeof ORDER_EDIT_FIELDS)[number])).toBe(true);
      }
    },
  );
});
