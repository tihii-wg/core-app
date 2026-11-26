import i18n from "../../i18n";

/**
 * Global «read-only» switch of the active workspace (trial over / subscription ended). Set by
 * useSyncWorkspaceReadOnlyMode (AppLayout) and read by the QueryClient MutationCache, so EVERY app write
 * that goes through a mutation is refused in one place — not only the ones whose buttons are hidden.
 * Personal / account actions (profile, password, sign out, switching or creating a workspace…) opt out
 * with `meta: { allowWhenReadOnly: true }`.
 */
let writeBlocked = false;

export function setWorkspaceWriteBlocked(blocked: boolean) {
  writeBlocked = blocked;
  if (typeof document !== "undefined") {
    if (blocked) document.documentElement.dataset.workspaceReadOnly = "true";
    else delete document.documentElement.dataset.workspaceReadOnly;
  }
}

export function isWorkspaceWriteBlocked() {
  return writeBlocked;
}

export class WorkspaceReadOnlyError extends Error {
  constructor() {
    super(i18n.t("settings.subscription.errors.writeDenied"));
    this.name = "WorkspaceReadOnlyError";
  }
}

/** Mutation meta: allowed while the workspace is read-only. */
export const ALLOW_WHEN_READ_ONLY = { allowWhenReadOnly: true } as const;
