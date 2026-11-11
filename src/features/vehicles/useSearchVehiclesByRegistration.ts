import { useQuery } from "@tanstack/react-query";
import { searchVehiclesByRegistration } from "../../services/apiVehicles";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function vehicleRegistrationSearchQueryKey(workspaceId: string | undefined, search: string) {
  return ["vehicles", "registration-search", workspaceId, search] as const;
}

/** Debounced plate / make / model search for the create-order Client combobox. */
export function useSearchVehiclesByRegistration(search: string, { enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const term = search.trim();
  const query = useQuery({
    queryKey: vehicleRegistrationSearchQueryKey(workspaceId, term),
    queryFn: () => searchVehiclesByRegistration(workspaceId, term),
    enabled: Boolean(workspaceId) && enabled && term.length >= 2,
  });

  return {
    // When disabled (short query / non-vehicle industry), never surface a stale prior search.
    hits: enabled ? (query.data ?? []) : [],
    isLoading: enabled && (query.isLoading || query.isFetching),
    isError: enabled && query.isError,
    error: query.error,
  };
}
