import { useTranslation } from "react-i18next";
import { CalendarClock, Check, Pencil, PlayCircle, RotateCcw, Trash2, UserRound } from "lucide-react";
import { Button } from "../../ui/Button";
import { StatusBadge } from "../../ui/StatusBadge";
import { cn } from "../../lib/utils";
import { isTaskOverdue, type TaskPriority, type TaskRecord, type TaskState } from "../../services/apiTasks";

const priorityVariants: Record<TaskPriority, "danger" | "warning" | "muted"> = {
  high: "danger",
  medium: "warning",
  low: "muted",
};

export function formatTaskDue(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

type TaskItemProps = {
  task: TaskRecord;
  assigneeName: string | null;
  authorName: string | null;
  statusName?: string | null;
  inProgress?: boolean;
  canChangeState: boolean;
  canEdit: boolean;
  busy?: boolean;
  /** Compact = reminder banner (no description, fewer actions). */
  compact?: boolean;
  onState: (state: TaskState) => void;
  onEdit?: () => void;
  onDelete?: () => void;
};

export function TaskItem({
  task,
  assigneeName,
  authorName,
  statusName,
  inProgress,
  canChangeState,
  canEdit,
  busy,
  compact,
  onState,
  onEdit,
  onDelete,
}: TaskItemProps) {
  const { t, i18n } = useTranslation();
  const done = Boolean(task.completedAt);
  const overdue = isTaskOverdue(task);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-start",
        done ? "border-border bg-muted/40" : overdue ? "border-destructive/50 bg-destructive/5" : "border-border bg-card",
      )}
    >
      <button
        type="button"
        disabled={!canChangeState || busy}
        onClick={() => onState(done ? "todo" : "done")}
        aria-label={done ? t("stage9.tasks.actions.reopen") : t("stage9.tasks.actions.done")}
        title={done ? t("stage9.tasks.actions.reopen") : t("stage9.tasks.actions.done")}
        className={cn(
          "mt-0.5 hidden size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors sm:flex",
          done ? "border-success bg-success text-white" : "border-border-strong hover:border-success hover:bg-success/10",
          (!canChangeState || busy) && "cursor-not-allowed opacity-50",
        )}
      >
        {done ? <Check className="size-3" aria-hidden /> : null}
      </button>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn("text-sm font-semibold text-foreground", done && "text-muted-foreground line-through")}>{task.title}</p>
          {!done && task.priority === "high" ? (
            <StatusBadge variant={priorityVariants.high}>{t("stage9.tasks.priorities.high")}</StatusBadge>
          ) : null}
          {overdue ? <StatusBadge variant="danger">{t("stage9.tasks.overdue")}</StatusBadge> : null}
          {!done && inProgress ? <StatusBadge variant="info">{t("stage9.tasks.inProgress")}</StatusBadge> : null}
          {!compact && statusName && !inProgress && !done ? (
            <StatusBadge variant="muted">{statusName}</StatusBadge>
          ) : null}
        </div>
        {!compact && task.description ? (
          <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">{task.description}</p>
        ) : null}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {task.dueAt ? (
            <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-destructive")}>
              <CalendarClock className="size-3.5" aria-hidden />
              {t("stage9.tasks.dueShort", { date: formatTaskDue(task.dueAt, i18n.language) })}
            </span>
          ) : null}
          {assigneeName ? (
            <span className="inline-flex items-center gap-1">
              <UserRound className="size-3.5" aria-hidden />
              {t("stage9.tasks.assigneeShort", { name: assigneeName })}
            </span>
          ) : null}
          {authorName ? <span>{t("stage9.tasks.authorShort", { name: authorName })}</span> : null}
          {done && task.completedAt ? (
            <span>{t("stage9.tasks.completedShort", { date: formatTaskDue(task.completedAt, i18n.language) })}</span>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {canChangeState && !done ? (
          <>
            {!inProgress && !compact ? (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onState("in_progress")}>
                <PlayCircle className="size-4" aria-hidden />
                {t("stage9.tasks.actions.start")}
              </Button>
            ) : null}
            <Button type="button" size="sm" disabled={busy} onClick={() => onState("done")}>
              <Check className="size-4" aria-hidden />
              {t("stage9.tasks.actions.done")}
            </Button>
          </>
        ) : null}
        {canChangeState && done && !compact ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onState("todo")}>
            <RotateCcw className="size-4" aria-hidden />
            {t("stage9.tasks.actions.reopen")}
          </Button>
        ) : null}
        {canEdit && onEdit && !compact ? (
          <Button type="button" size="icon-sm" variant="ghost" aria-label={t("common.edit")} onClick={onEdit} disabled={busy}>
            <Pencil className="size-4" aria-hidden />
          </Button>
        ) : null}
        {canEdit && onDelete && !compact ? (
          <Button type="button" size="icon-sm" variant="ghost" aria-label={t("common.delete")} onClick={onDelete} disabled={busy}>
            <Trash2 className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
