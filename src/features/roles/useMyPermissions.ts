import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMyPermissions } from "../../services/apiRoles";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { hasPermission } from "./permissions";

/**
 * Permission keys of the current user, or `null` while loading / on error / when the RO tables are absent.
 * `null` means "legacy mode": callers must fall back to existing role/subscription checks.
 */
export function useMyPermissions() {
  const { workspaceId } = useActiveWorkspaceId();
  const query = useQuery({
    queryKey: ["my-permissions", workspaceId],
    queryFn: () => getMyPermissions(workspaceId),
    enabled: Boolean(workspaceId),
    retry: false,
    staleTime: 60_000,
  });
  const permissions = query.data ?? null;

  const can = useCallback(
    (key: string, legacyFallback = true) => hasPermission(permissions, key, legacyFallback),
    [permissions],
  );

  return { permissions, isLoading: query.isLoading, can };
}
