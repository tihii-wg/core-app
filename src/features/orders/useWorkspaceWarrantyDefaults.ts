import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import type { WorkspaceWarrantyDefaults } from "./warranty";

/** Workspace-wide default warranty (services / parts) used to seed new order lines. */
export function useWorkspaceWarrantyDefaults(): WorkspaceWarrantyDefaults {
  const { data: workspace } = useGetWorkspace();
  return {
    serviceDurationMonths: workspace?.warrantyServiceMonths ?? null,
    serviceMileageLimit: workspace?.warrantyServiceKm ?? null,
    partsDurationMonths: workspace?.warrantyPartsMonths ?? null,
    partsMileageLimit: workspace?.warrantyPartsKm ?? null,
  };
}
