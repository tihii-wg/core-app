import i18n from "../i18n";
import supabase from "./supabase";
import { deleteStage9Row, insertStage9Row, resolveDefaultStatusId, str, updateStage9Row } from "./apiStage9List";
import { isMissingTableError, requireWorkspaceId } from "./missingTable";

export type TaskPriority = "high" | "medium" | "low";
export type TaskState = "todo" | "in_progress" | "done";
export type TaskScope = "mine" | "created" | "all";

export type TaskRecord = {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  statusId: string | null;
  dueAt: string | null;
  createdAt: string;
  completedAt: string | null;
  createdBy: string | null;
  assignedTo: string | null;
  /** Order the task is about (tasks.order_id) — its number for display. */
  orderId: string | null;
  orderNumber: string | null;
  clientId: string | null;
};

const taskColumns =
  "id, title, description, priority, status_id, due_at, created_at, completed_at, created_by, assigned_to, order_id, client_id, task_order:orders(number)";
const legacyTaskColumns = "id, title, priority, status_id, due_at, created_at";

export function toTask(row: Record<string, unknown>): TaskRecord {
  return {
    id: String(row.id),
    title: typeof row.title === "string" ? row.title : "",
    description: str(row.description),
    priority: row.priority === "high" || row.priority === "low" ? row.priority : "medium",
    statusId: str(row.status_id),
    dueAt: str(row.due_at),
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    completedAt: str(row.completed_at),
    createdBy: str(row.created_by),
    assignedTo: str(row.assigned_to),
    orderId: str(row.order_id),
    orderNumber: str((row.task_order as { number?: unknown } | null | undefined)?.number),
    clientId: str(row.client_id),
  };
}

export type TaskListResult = {
  rows: TaskRecord[];
  /** `tasks` table not applied (crm_ro_v1). */
  isUnavailable: boolean;
  /** `tasks.assigned_to` not applied yet (20261116130000_task_assignment). */
  assignmentUnavailable: boolean;
};

function isMissingAssignedTo(error: { code?: string; message?: string } | null) {
  return Boolean(error) && /assigned_to/i.test(error?.message ?? "") && (error?.code === "42703" || error?.code === "PGRST204" || /does not exist|schema cache/i.test(error?.message ?? ""));
}

/** Local session (no network): used to filter reads; RLS enforces auth.uid() server-side. */
async function currentUserId() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/**
 * Tasks of the workspace. `mine` = assigned to me, `created` = set by me, `all` = what RLS lets me see.
 * Open tasks first (by due date), then completed ones.
 */
export async function getTasks(workspaceId: string | undefined, scope: TaskScope = "all"): Promise<TaskListResult> {
  const id = requireWorkspaceId(workspaceId);
  const userId = scope === "all" ? null : await currentUserId();

  let query = supabase.from("tasks").select(taskColumns).eq("workspace_id", id).is("deleted_at", null);
  if (scope === "mine" && userId) query = query.eq("assigned_to", userId);
  if (scope === "created" && userId) query = query.eq("created_by", userId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(500);

  if (error) {
    // Check the column first: "column tasks.assigned_to does not exist" also looks like a missing-table message.
    if (!isMissingAssignedTo(error) && isMissingTableError(error, "tasks")) {
      return { rows: [], isUnavailable: true, assignmentUnavailable: true };
    }
    if (isMissingAssignedTo(error)) {
      if (scope === "mine") return { rows: [], isUnavailable: false, assignmentUnavailable: true };
      const legacy = await supabase
        .from("tasks")
        .select(legacyTaskColumns)
        .eq("workspace_id", id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (legacy.error) throw new Error(legacy.error.message);
      return {
        rows: ((legacy.data ?? []) as Record<string, unknown>[]).map(toTask),
        isUnavailable: false,
        assignmentUnavailable: true,
      };
    }
    throw new Error(error.message);
  }
  return {
    rows: sortTasks(((data ?? []) as Record<string, unknown>[]).map(toTask)),
    isUnavailable: false,
    assignmentUnavailable: false,
  };
}

/** Open first (earliest due first, no due date last), then completed (latest first). Pure. */
export function sortTasks(rows: TaskRecord[]): TaskRecord[] {
  return [...rows].sort((a, b) => {
    if (!a.completedAt !== !b.completedAt) return a.completedAt ? 1 : -1;
    if (a.completedAt && b.completedAt) return b.completedAt.localeCompare(a.completedAt);
    if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
    if (a.dueAt !== b.dueAt) return a.dueAt ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/** Open tasks assigned to the current user (for the always-visible reminder). */
export async function getMyOpenTasks(workspaceId: string | undefined): Promise<TaskRecord[]> {
  const id = requireWorkspaceId(workspaceId);
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from("tasks")
    .select(taskColumns)
    .eq("workspace_id", id)
    .eq("assigned_to", userId)
    .is("deleted_at", null)
    .is("completed_at", null)
    .limit(100);
  if (error) {
    if (isMissingTableError(error, "tasks") || isMissingAssignedTo(error)) return [];
    throw new Error(error.message);
  }
  return sortTasks(((data ?? []) as Record<string, unknown>[]).map(toTask));
}

export type TaskInput = {
  title: string;
  priority: TaskPriority;
  /** ISO timestamp, or null/blank for no due date. */
  dueAt: string | null;
  description?: string | null;
  /** Workspace member (auth user id) who must do the task; null = nobody. */
  assignedTo?: string | null;
  /** Linked order (null = none); its client is stored with it. */
  orderId?: string | null;
  clientId?: string | null;
};

const MAX_TASK_TITLE = 256;
const MAX_TASK_DESCRIPTION = 4000;

/** Validates a task form and builds the writable columns. Pure. */
export function buildTaskRow(input: TaskInput) {
  const title = input.title.trim();
  if (!title) throw new Error(i18n.t("stage9.tasks.errors.titleRequired"));
  if (title.length > MAX_TASK_TITLE) throw new Error(i18n.t("stage9.tasks.errors.titleTooLong", { max: MAX_TASK_TITLE }));
  const dueAt = input.dueAt?.trim() ? input.dueAt.trim() : null;
  if (dueAt && Number.isNaN(new Date(dueAt).getTime())) throw new Error(i18n.t("stage9.errors.invalidDate"));
  const priority: TaskPriority = input.priority === "high" || input.priority === "low" ? input.priority : "medium";
  const row: Record<string, unknown> = { title, priority, due_at: dueAt };
  if (input.description !== undefined) {
    const description = input.description?.trim() ?? "";
    if (description.length > MAX_TASK_DESCRIPTION) {
      throw new Error(i18n.t("stage9.tasks.errors.descriptionTooLong", { max: MAX_TASK_DESCRIPTION }));
    }
    row.description = description || null;
  }
  if (input.assignedTo !== undefined) row.assigned_to = input.assignedTo || null;
  if (input.orderId !== undefined) {
    row.order_id = input.orderId || null;
    row.client_id = input.orderId ? input.clientId || null : null;
  }
  return row as {
    title: string;
    priority: TaskPriority;
    due_at: string | null;
    description?: string | null;
    assigned_to?: string | null;
    order_id?: string | null;
    client_id?: string | null;
  };
}

function mapTaskWriteError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/assignee_not_member/.test(message)) throw new Error(i18n.t("stage9.tasks.errors.assigneeNotMember"));
  if (/assigned_to/.test(message)) throw new Error(i18n.t("stage9.tasks.errors.assignmentUnavailable"));
  throw error instanceof Error ? error : new Error(message);
}

export async function createTask(input: TaskInput, workspaceId: string | undefined) {
  const row = buildTaskRow(input);
  const statusId = await resolveDefaultStatusId("task", workspaceId);
  try {
    return await insertStage9Row("tasks", statusId ? { ...row, status_id: statusId } : row, workspaceId);
  } catch (error) {
    return mapTaskWriteError(error);
  }
}

export async function updateTask(id: string, input: TaskInput, workspaceId: string | undefined) {
  try {
    return await updateStage9Row("tasks", id, buildTaskRow(input), workspaceId);
  } catch (error) {
    return mapTaskWriteError(error);
  }
}

/** Soft-deletes a task (`deleted_at`). */
export function deleteTask(id: string, workspaceId: string | undefined) {
  return deleteStage9Row("tasks", id, workspaceId);
}

/** Author, assignee or tasks.edit: move the task to todo / in progress / done. */
export async function setTaskState(id: string, state: TaskState) {
  const { error } = await supabase.rpc("crm_task_set_state", { p_task_id: id, p_state: state });
  if (!error) return;
  if (error.code === "PGRST202" || /crm_task_set_state/.test(error.message ?? "")) {
    throw new Error(i18n.t("stage9.tasks.errors.assignmentUnavailable"));
  }
  if (error.code === "42501") throw new Error(i18n.t("stage9.errors.noPermission"));
  throw new Error(error.message);
}

/** Overdue = open with a due date in the past. Pure. */
export function isTaskOverdue(task: Pick<TaskRecord, "dueAt" | "completedAt">, now = new Date()) {
  if (task.completedAt || !task.dueAt) return false;
  const due = new Date(task.dueAt);
  return !Number.isNaN(due.getTime()) && due.getTime() < now.getTime();
}

export type TaskOrderOption = { id: string; number: string; clientId: string | null; clientName: string };

/** Orders to link a task to: by number or client name, newest first (a short list for the picker). */
export async function searchOrdersForTask(workspaceId: string | undefined, term: string, limit = 10): Promise<TaskOrderOption[]> {
  const id = requireWorkspaceId(workspaceId);
  const safe = term.trim().replace(/[%_,()*\\]/g, " ").trim();
  let query = supabase
    .from("orders")
    .select("id, number, client_id, clients!orders_client_id_fkey(name)")
    .eq("workspace_id", id);
  if (safe) {
    // Client name match → its order ids are found through the embedded filter below.
    query = query.or(`number.ilike.%${safe}%,device.ilike.%${safe}%,car_number.ilike.%${safe}%`);
  }
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  let rows = (data ?? []) as Record<string, unknown>[];
  if (safe && rows.length < limit) {
    // Also by client name (a filter on the embedded client).
    const byClient = await supabase
      .from("orders")
      .select("id, number, client_id, clients!orders_client_id_fkey!inner(name)")
      .eq("workspace_id", id)
      .ilike("clients.name", `%${safe}%`)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!byClient.error) {
      const seen = new Set(rows.map((row) => String(row.id)));
      rows = [...rows, ...((byClient.data ?? []) as Record<string, unknown>[]).filter((row) => !seen.has(String(row.id)))].slice(0, limit);
    }
  }
  return rows.map((row) => ({
    id: String(row.id),
    number: typeof row.number === "string" ? row.number : "",
    clientId: str(row.client_id),
    clientName: str((row.clients as { name?: unknown } | null | undefined)?.name) ?? "",
  }));
}
