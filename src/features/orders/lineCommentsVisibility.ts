import type { VisibilityDefault } from "../../lib/workspaceGeneralSettings";
import { isOrderLineCommentsSupported } from "../../services/apiOrders";
import { isLineCommentsVisibilityColumnSupported } from "../../services/apiWorkspaces";

/** Whether this user may see/edit line comments in the order card. */
export function canAccessOrderLineComments(opts: {
  visibility: VisibilityDefault | string | null | undefined;
  isOwner: boolean;
  /** When false, SQL not applied — hide UI. Defaults to the module feature flag. */
  supported?: boolean;
}): boolean {
  // Hidden until the SQL is applied: both the comments table and the workspace setting column must exist.
  const supported = opts.supported ?? (isOrderLineCommentsSupported() && isLineCommentsVisibilityColumnSupported());
  if (!supported) return false;
  const visibility = opts.visibility === "public" ? "public" : "private";
  return visibility === "public" || opts.isOwner;
}
