import { useActiveWorkspaceId, useGetProfile } from "../profiles/useGetProfile";
import { useGetWorkspace } from "./useGetWorkspace";

/**
 * Authoritative owner check for UI: `workspaces.owner_id === profiles.id`.
 * Prefer this over membership `role === "owner"` when unlocking closed-order status edits.
 * API/RPC still re-check `workspaces.owner_id` via auth.uid().
 */
export function useIsWorkspaceOwnerId() {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: profile } = useGetProfile();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const ownerId = workspace?.ownerId ?? null;
  const profileId = profile?.id ?? null;
  return Boolean(ownerId && profileId && ownerId === profileId);
}
