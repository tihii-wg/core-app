import type { IndustryWorkflow } from "./industryWorkflow";

/**
 * Central industry capability flags.
 * Prefer this over scattering `slug === "auto_repair"` in UI components.
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
