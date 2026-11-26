import { useEffect } from "react";
import { setWorkspaceWriteBlocked } from "./readOnlyMode";
import { useWorkspaceSubscription } from "./useWorkspaceSubscription";

/** Keeps the global read-only switch in step with the active workspace's subscription. */
export function useSyncWorkspaceReadOnlyMode() {
  const { canWrite, isEntitlementPending } = useWorkspaceSubscription();
  // While the entitlement loads, do not block (no false «read-only» on reload); the server stays the guard.
  const blocked = !isEntitlementPending && !canWrite;
  useEffect(() => {
    setWorkspaceWriteBlocked(blocked);
  }, [blocked]);
  useEffect(() => () => setWorkspaceWriteBlocked(false), []);
}
