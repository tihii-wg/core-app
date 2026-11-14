import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListChecks, Plus } from "lucide-react";
import { PageHeader } from "../../pages/PageHeader";
import { Button } from "../../ui/Button";
import { Card, CardContent } from "../../ui/Card";
import { EmptyState } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";
import { Switch } from "../../ui/Switch";
import { useConfirm } from "../../ui/ConfirmProvider";
import { cn } from "../../lib/utils";
import type { TaskRecord, TaskScope } from "../../services/apiTasks";
import { useMyPermissions } from "../roles/useMyPermissions";
import { useStatusLookup } from "../stage9/useStatusLookup";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { TaskFormDialog } from "./TaskFormDialog";
import { TaskItem } from "./TaskItem";
import { useGetTasks, useMyOpenTasks } from "./useGetTasks";
import { useDeleteTask, useSetTaskState } from "./useTaskMutations";
import { useTeamDirectory } from "./useTeamDirectory";

export function Tasks() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { can } = useMyPermissions();
  const canViewAll = can("tasks.view");
  const { canWrite } = useWorkspaceSubscription();
  const myOpen = useMyOpenTasks();
  const [scope, setScope] = useState<TaskScope>("mine");
  const [showDone, setShowDone] = useState(false);
  const query = useGetTasks(scope);
  const team = useTeamDirectory();
  const statuses = useStatusLookup();
  const setState = useSetTaskState();
  const deleteTask = useDeleteTask();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TaskRecord | null>(null);

  const assignmentAvailable = !query.data?.assignmentUnavailable;
  const rows = useMemo(
    () => (query.data?.rows ?? []).filter((task) => showDone || !task.completedAt),
    [query.data?.rows, showDone],
  );
  const doneCount = (query.data?.rows ?? []).filter((task) => task.completedAt).length;

  const scopes: { key: TaskScope; label: string; count?: number }[] = [
    { key: "mine", label: t("stage9.tasks.scopes.mine"), count: myOpen.data?.length },
    { key: "created", label: t("stage9.tasks.scopes.created") },
    ...(canViewAll ? [{ key: "all" as const, label: t("stage9.tasks.scopes.all") }] : []),
  ];

  const canEditTask = (task: TaskRecord) =>
    canWrite && (task.createdBy === team.currentUserId || can("tasks.edit"));
  const canChangeState = (task: TaskRecord) =>
    canWrite && (task.assignedTo === team.currentUserId || task.createdBy === team.currentUserId || can("tasks.edit"));

  async function onDelete(task: TaskRecord) {
    const ok = await confirm({
      title: t("stage9.tasks.confirmDelete.title"),
      description: t("stage9.tasks.confirmDelete.description", { title: task.title }),
      confirmLabel: t("common.delete"),
      tone: "destructive",
      icon: "warning",
    });
    if (ok) deleteTask.mutate(task.id);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("stage9.tasks.title")}
        description={t("stage9.tasks.description")}
        actions={
          canWrite && !query.data?.isUnavailable ? (
            <Button
              type="button"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus />
              {t("stage9.tasks.add")}
            </Button>
          ) : null
        }
      />

      {query.data?.assignmentUnavailable && !query.data.isUnavailable ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-foreground">
          {t("stage9.tasks.assignmentUnavailable")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5" role="tablist">
          {scopes.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={scope === item.key}
              onClick={() => setScope(item.key)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors",
                scope === item.key ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
              {item.count ? (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-[10px] font-semibold text-warning-foreground">
                  {item.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
          <Switch checked={showDone} onCheckedChange={setShowDone} aria-label={t("stage9.tasks.showDone")} />
          {t("stage9.tasks.showDone")}
          {doneCount ? <span className="tabular-nums">({doneCount})</span> : null}
        </label>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : query.error ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">{query.error.message}</CardContent>
        </Card>
      ) : query.data?.isUnavailable ? (
        <EmptyState icon={ListChecks} title={t("stage9.unavailable.title")} description={t("stage9.unavailable.description", { table: "tasks" })} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={t(`stage9.tasks.emptyScopes.${scope}.title`)}
          description={t(`stage9.tasks.emptyScopes.${scope}.description`)}
        />
      ) : (
        <div className="space-y-2">
          {rows.map((task) => {
            const status = task.statusId ? statuses.get(task.statusId) : undefined;
            return (
              <TaskItem
                key={task.id}
                task={task}
                assigneeName={team.nameOf(task.assignedTo)}
                authorName={team.nameOf(task.createdBy)}
                statusName={status?.name ?? null}
                inProgress={status?.statusGroup === "in_progress"}
                canChangeState={canChangeState(task)}
                canEdit={canEditTask(task)}
                busy={setState.isPending || deleteTask.isPending}
                onState={(state) => setState.mutate({ id: task.id, state })}
                onEdit={() => {
                  setEditing(task);
                  setFormOpen(true);
                }}
                onDelete={() => void onDelete(task)}
              />
            );
          })}
        </div>
      )}

      <TaskFormDialog open={formOpen} onOpenChange={setFormOpen} task={editing} assignmentAvailable={assignmentAvailable} />
    </div>
  );
}
