import { useState } from "react";
import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Column } from "../../ui/DataTable";
import { StatusBadge } from "../../ui/StatusBadge";
import type { TaskPriority, TaskRecord } from "../../services/apiTasks";
import { DateCell, Stage9ListPage, StatusCell } from "../stage9/Stage9ListPage";
import { useStatusLookup } from "../stage9/useStatusLookup";
import { TaskFormDialog } from "./TaskFormDialog";
import { useGetTasks } from "./useGetTasks";
import { useDeleteTask } from "./useTaskMutations";

const priorityVariants: Record<TaskPriority, "danger" | "warning" | "muted"> = {
  high: "danger",
  medium: "warning",
  low: "muted",
};

export function Tasks() {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useGetTasks();
  const statuses = useStatusLookup();
  const deleteTask = useDeleteTask();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TaskRecord | null>(null);

  const columns: Column<TaskRecord>[] = [
    {
      key: "id",
      header: t("stage9.columns.id"),
      className: "w-[120px] whitespace-nowrap",
      cell: (task) => <span className="font-mono text-xs text-muted-foreground">{task.id.slice(0, 8)}</span>,
    },
    {
      key: "title",
      header: t("stage9.columns.title"),
      cell: (task) => <p className="max-w-[28rem] truncate font-medium text-foreground" title={task.title}>{task.title}</p>,
    },
    {
      key: "status",
      header: t("common.status"),
      cell: (task) => <StatusCell statusId={task.statusId} lookup={statuses} />,
    },
    {
      key: "priority",
      header: t("stage9.tasks.priority"),
      className: "hidden sm:table-cell",
      cell: (task) => <StatusBadge variant={priorityVariants[task.priority]}>{t(`stage9.tasks.priorities.${task.priority}`)}</StatusBadge>,
    },
    {
      key: "due",
      header: t("stage9.tasks.dueAt"),
      className: "hidden md:table-cell",
      cell: (task) => <DateCell value={task.dueAt} withTime />,
    },
    {
      key: "created",
      header: t("stage9.columns.createdAt"),
      className: "hidden lg:table-cell",
      cell: (task) => <DateCell value={task.createdAt} />,
    },
  ];

  return (
    <>
      <Stage9ListPage
        module="tasks"
        table="tasks"
        icon={ListChecks}
        columns={columns}
        keyExtractor={(task) => task.id}
        data={data}
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        onAdd={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        onEdit={(task) => {
          setEditing(task);
          setFormOpen(true);
        }}
        onDelete={(task) => deleteTask.mutate(task.id)}
        rowLabel={(task) => task.title}
        isMutating={deleteTask.isPending}
      />
      <TaskFormDialog open={formOpen} onOpenChange={setFormOpen} task={editing} />
    </>
  );
}
