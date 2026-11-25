import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useDebounce } from "../../hooks/useDebounce";
import { isValidOptionalVin, normalizeVin } from "../../lib/vin";
import { findVehicleByVin, type VinOwnerMatch } from "../../services/apiVehicles";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function vinOwnerQueryKey(workspaceId: string | undefined, vin: string, excludeVehicleId: string | null | undefined) {
  return ["vehicle-vin-owner", workspaceId, vin, excludeVehicleId ?? ""] as const;
}

/** Only a complete, valid VIN is looked up (17 characters). */
export function lookupableVin(value: string | null | undefined): string {
  const vin = normalizeVin(value);
  return vin.length === 17 && isValidOptionalVin(vin) ? vin : "";
}

/** Live check while typing: which client already has this VIN (debounced, cached per VIN). */
export function useVinOwner(vin: string | null | undefined, excludeVehicleId?: string | null) {
  const { workspaceId } = useActiveWorkspaceId();
  const debounced = useDebounce(lookupableVin(vin), 350);
  const query = useQuery({
    queryKey: vinOwnerQueryKey(workspaceId, debounced, excludeVehicleId),
    queryFn: () => findVehicleByVin(workspaceId, debounced, { excludeVehicleId }),
    enabled: Boolean(workspaceId && debounced),
    staleTime: 30_000,
  });
  const current = lookupableVin(vin);
  return {
    // A stale answer for a VIN the user has since changed is never shown.
    match: current && current === debounced ? (query.data ?? null) : null,
    checking: Boolean(current) && (current !== debounced || query.isFetching),
  };
}

/** Same lookup at save time — answered from the cache when the live check already ran. */
export function fetchVinOwner(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  vin: string | null | undefined,
  excludeVehicleId?: string | null,
): Promise<VinOwnerMatch | null> {
  const normalized = lookupableVin(vin);
  if (!normalized) return Promise.resolve(null);
  return queryClient.fetchQuery({
    queryKey: vinOwnerQueryKey(workspaceId, normalized, excludeVehicleId),
    queryFn: () => findVehicleByVin(workspaceId, normalized, { excludeVehicleId }),
    staleTime: 30_000,
  });
}

export function vinOwnerVehicleLabel(match: Pick<VinOwnerMatch, "make" | "model" | "year" | "licensePlate">) {
  return [match.make, match.model, match.year != null ? String(match.year) : null, match.licensePlate]
    .filter(Boolean)
    .join(" ")
    .trim();
}
