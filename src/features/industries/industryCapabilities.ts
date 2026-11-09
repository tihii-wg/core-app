import { industryProfile, type IndustryProfile } from "./industryProfile";
import type { IndustryWorkflow } from "./industryWorkflow";

/**
 * Central industry capability flags.
 * Prefer this over scattering industry slug comparisons in UI components.
 */
export type IndustryCapabilities = {
  /** Client-owned vehicles table + vehicle picker on orders. */
  clientVehicles: boolean;
  /**
   * Automotive copy pack / historical order columns (device, plate, VIN).
   * Order create/edit UIs no longer collect these when clientVehicles is on —
   * use the client vehicle workflow instead. Detail views may still show stored values.
   */
  automotiveOrderAssets: boolean;
  /** Inventory / warehouse wording as materials warehouse (furniture). */
  materialsWarehouseLabel: boolean;
};

export function industryCapabilitiesFromProfile(profile: IndustryProfile): IndustryCapabilities {
  return {
    clientVehicles: profile.navigation.clientVehicles,
    automotiveOrderAssets: profile.assetKind === "vehicle",
    materialsWarehouseLabel: profile.navigation.materialsWarehouseLabel,
  };
}

export function industryCapabilities(workflow: IndustryWorkflow): IndustryCapabilities {
  return industryCapabilitiesFromProfile(industryProfile(workflow.slug));
}

export function industrySupportsClientVehicles(workflow: IndustryWorkflow) {
  return industryCapabilities(workflow).clientVehicles;
}

/**
 * Mileage / km warranty limits apply only to vehicle industries (currently auto_repair).
 * Same gate as client vehicles — pass a single `showWarrantyKm` boolean into forms/display.
 */
export function industryUsesMileageWarranty(workflow: IndustryWorkflow) {
  return industrySupportsClientVehicles(workflow);
}
