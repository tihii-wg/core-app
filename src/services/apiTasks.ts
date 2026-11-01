import i18n from "../i18n";
import {
  deleteStage9Row,
  insertStage9Row,
  listStage9Rows,
  resolveDefaultStatusId,
  str,
  updateStage9Row,
} from "./apiStage9List";

export type TaskPriority = "high" | "medium" | "low";

export type TaskRecord = {
  id: string;
  title: string;
  priority: TaskPriority;
  statusId: string | null;
  dueAt: string | null;
  createdAt: string;
};

const taskColumns = "id, title, priority, status_id, due_at, created_at";

export function toTask(row: Record<string, unknown>): TaskRecord {
  return {
    id: String(row.id),
    title: typeof row.title === "string" ? row.title : "",
    priority: row.priority === "high" || row.priority === "low" ? row.priority : "medium",
    statusId: str(row.status_id),
    dueAt: str(row.due_at),
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

/** Lists tasks, newest first. Resolves to `isUnavailable` when the `tasks` table is not applied. */
export function getTasks(workspaceId: string | undefined) {
  return listStage9Rows("tasks", taskColumns, workspaceId, "created_at", false, toTask);
}

export type TaskInput = {
  title: string;
  priority: TaskPriority;
  /** ISO timestamp, or null/blank for no due date. */
  dueAt: string | null;
};

const MAX_TASK_TITLE = 256;

/** Validates a task form and builds the writable columns. Pure. */
export function buildTaskRow(input: TaskInput) {
  const title = input.title.trim();
  if (!title) throw new Error(i18n.t("stage9.tasks.errors.titleRequired"));
  if (title.length > MAX_TASK_TITLE) throw new Error(i18n.t("stage9.tasks.errors.titleTooLong", { max: MAX_TASK_TITLE }));
  const dueAt = input.dueAt?.trim() ? input.dueAt.trim() : null;
  if (dueAt && Number.isNaN(new Date(dueAt).getTime())) throw new Error(i18n.t("stage9.errors.invalidDate"));
  const priority: TaskPriority = input.priority === "high" || input.priority === "low" ? input.priority : "medium";
  return { title, priority, due_at: dueAt };
}

export async function createTask(input: TaskInput, workspaceId: string | undefined) {
  const row = buildTaskRow(input);
  const statusId = await resolveDefaultStatusId("task", workspaceId);
  return insertStage9Row("tasks", statusId ? { ...row, status_id: statusId } : row, workspaceId);
}

export function updateTask(id: string, input: TaskInput, workspaceId: string | undefined) {
  return updateStage9Row("tasks", id, buildTaskRow(input), workspaceId);
}

/** Soft-deletes a task (`deleted_at`). */
export function deleteTask(id: string, workspaceId: string | undefined) {
  return deleteStage9Row("tasks", id, workspaceId);
}
