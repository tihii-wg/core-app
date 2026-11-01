import supabase from "./supabase";
import { isMissingTableError, requireWorkspaceId } from "./missingTable";

export type ActivityLogEntry = {
  id: string;
  createdAt: string;
  actorName: string | null;
  entityType: string;
  entityId: string | null;
  event: string;
};

export type ActivityLogResult = {
  entries: ActivityLogEntry[];
  /** True when the `activity_log` table is not applied in this database yet (crm_ro_v1.PRODUCTION.sql). */
  isUnavailable: boolean;
};

const activityLogColumns = "id, created_at, actor_name, entity_type, entity_id, event";

export function toActivityLogEntry(row: Record<string, unknown>): ActivityLogEntry {
  return {
    id: String(row.id),
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    actorName: typeof row.actor_name === "string" && row.actor_name.trim() ? row.actor_name : null,
    entityType: typeof row.entity_type === "string" ? row.entity_type : "",
    entityId: typeof row.entity_id === "string" ? row.entity_id : null,
    event: typeof row.event === "string" ? row.event : "",
  };
}

export type RecordActivityInput = {
  workspaceId: string | undefined;
  entityType: string;
  entityId?: string | null;
  event: string;
  details?: Record<string, unknown>;
  actorName?: string | null;
};

export type RecordActivityResult = { recorded: boolean };

type AuthUserLike = { id?: string; email?: string | null; user_metadata?: Record<string, unknown> | null } | null | undefined;

/** Picks a display name for the log from explicit input first, then auth metadata, then email. Pure. */
export function resolveActorName(explicit: string | null | undefined, user: AuthUserLike): string | null {
  const pick = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const meta = user?.user_metadata ?? {};
  return pick(explicit) ?? pick(meta.full_name) ?? pick(meta.name) ?? pick(user?.email) ?? null;
}

/** Builds the activity_log insert row. Pure and unit-testable. */
export function buildActivityRow(input: RecordActivityInput & { workspaceId: string }, user: AuthUserLike) {
  return {
    workspace_id: input.workspaceId,
    actor_user_id: user?.id ?? null,
    actor_name: resolveActorName(input.actorName, user),
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    event: input.event,
    details: input.details ?? {},
  };
}

/**
 * Best-effort audit write. Never throws: a missing activity_log table, RLS denial,
 * or any other failure resolves to { recorded: false } so the primary mutation is unaffected.
 */
export async function recordActivity(input: RecordActivityInput): Promise<RecordActivityResult> {
  try {
    const workspaceId = input.workspaceId?.trim();
    if (!workspaceId) return { recorded: false };

    let user: AuthUserLike = null;
    try {
      const { data } = await supabase.auth.getUser();
      user = data?.user ?? null;
    } catch {
      user = null;
    }

    const { error } = await supabase.from("activity_log").insert(buildActivityRow({ ...input, workspaceId }, user));
    // Missing table (isMissingTableError), RLS denial and any other error all degrade silently.
    if (error) return { recorded: false };
    return { recorded: true };
  } catch {
    return { recorded: false };
  }
}

/** Latest activity for the workspace. Read-only; RLS limits this to members with `reports.activity_log`. */
export async function getActivityLog(workspaceId: string | undefined, limit = 100): Promise<ActivityLogResult> {
  const id = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("activity_log")
    .select(activityLogColumns)
    .eq("workspace_id", id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingTableError(error, "activity_log")) return { entries: [], isUnavailable: true };
    throw new Error(error.message);
  }
  return { entries: ((data ?? []) as Record<string, unknown>[]).map(toActivityLogEntry), isUnavailable: false };
}
