import type { IndustryWorkflow } from "./industryWorkflow";

/**
 * Central industry capability flags.
 * Prefer this over scattering `slug === "auto_repair"` in UI components.
 */
export type IndustryCapabilities = {
  /** Client-owned vehicles table + vehicle picker on orders. */
  clientVehicles: boolean;
  /** Legacy order-level plate/VIN/device automotive labels (auto_repair pack). */
  automotiveOrderAssets: boolean;
};

export function industryCapabilities(workflow: IndustryWorkflow): IndustryCapabilities {
  const automotive = workflow.slug === "auto_repair";
  return {
    clientVehicles: automotive,
    automotiveOrderAssets: automotive,
  };
}

export function industrySupportsClientVehicles(workflow: IndustryWorkflow) {
  return industryCapabilities(workflow).clientVehicles;
}
