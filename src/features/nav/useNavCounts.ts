import { useQueries } from "@tanstack/react-query";
import {
  countWorkspaceNavModule,
  NAV_COUNT_MODULES,
  navCountQueryKey,
  type NavCountModule,
} from "../../services/apiNavCounts";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export type NavCounts = Partial<Record<NavCountModule, number>>;

/**
 * Live workspace totals for sidebar badges.
 * Query keys are prefixed with the entity name so existing mutation invalidation
 * (`["orders", workspaceId]`, etc.) refreshes the matching count without extra wiring.
 */
export function useNavCounts() {
  const { workspaceId } = useActiveWorkspaceId();
  const enabled = Boolean(workspaceId);

  const results = useQueries({
    queries: NAV_COUNT_MODULES.map((module) => ({
      queryKey: navCountQueryKey(module, workspaceId),
      queryFn: () => countWorkspaceNavModule(module, workspaceId),
      enabled,
      staleTime: 30_000,
    })),
  });

  const counts: NavCounts = {};
  for (let index = 0; index < NAV_COUNT_MODULES.length; index += 1) {
    const module = NAV_COUNT_MODULES[index];
    const result = results[index];
    if (result.isSuccess && typeof result.data === "number") {
      counts[module] = result.data;
    }
  }

  return {
    counts,
    isLoading: enabled && results.some((result) => result.isPending),
    hasError: results.some((result) => result.isError),
  };
}
