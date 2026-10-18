import type { ListedWorkspaceMembership } from "../../services/apiWorkspaces";

function listedWorkspaces(membership: ListedWorkspaceMembership) {
  if (!membership.workspaces) return [];
  return Array.isArray(membership.workspaces) ? membership.workspaces : [membership.workspaces];
}

/** Active workspace id when its owner still has no industry. Null means setup is not required. */
export function ownedWorkspaceNeedingSetup(memberships: ListedWorkspaceMembership[] | undefined, activeWorkspaceId: string | null, userId: string | null) {
  if (!memberships || !activeWorkspaceId || !userId) return null;

  for (const membership of memberships) {
    for (const workspace of listedWorkspaces(membership)) {
      if (workspace.id !== activeWorkspaceId || !("industry_id" in workspace)) continue;
      if (workspace.owner_id !== userId) return null;
      if (typeof workspace.industry_id === "string" && workspace.industry_id) return null;
      if (workspace.industry_id == null) return activeWorkspaceId;
    }
  }

  return null;
}

export function rememberWorkspaceIndustry(memberships: ListedWorkspaceMembership[], workspaceId: string, industryId: string): ListedWorkspaceMembership[] {
  return memberships.map((membership) => {
    const workspaces = membership.workspaces;
    if (!workspaces) return membership;
    const apply = <T extends { id: string }>(workspace: T) => (workspace.id === workspaceId ? { ...workspace, industry_id: industryId } : workspace);
    if (Array.isArray(workspaces)) return { ...membership, workspaces: workspaces.map(apply) };
    return { ...membership, workspaces: apply(workspaces) };
  });
}
