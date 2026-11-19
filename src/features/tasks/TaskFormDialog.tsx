import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import { Textarea } from "../../ui/Textarea";
import { searchOrdersForTask, type TaskOrderOption, type TaskPriority, type TaskRecord } from "../../services/apiTasks";
import { useDebounce } from "../../hooks/useDebounce";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "../stage9/datetimeLocal";
import { useCreateTask, useUpdateTask } from "./useTaskMutations";
import { useTeamDirectory } from "./useTeamDirectory";

type TaskFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set the dialog edits this task; otherwise it creates one. */
  task?: TaskRecord | null;
  /** False when tasks.assigned_to is not applied yet: the assignee field is hidden. */
  assignmentAvailable?: boolean;
  /** New task about this order (e.g. «Create task» in an order's menu). */
  initialOrder?: TaskOrderOption | null;
};

const priorities: readonly TaskPriority[] = ["high", "medium", "low"];

export function TaskFormDialog({ open, onOpenChange, task, assignmentAvailable = true, initialOrder = null }: TaskFormDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? t("stage9.tasks.form.editTitle") : t("stage9.tasks.form.title")}</DialogTitle>
          <DialogDescription>{t("stage9.tasks.form.description")}</DialogDescription>
        </DialogHeader>
        {open ? (
          <TaskForm
            key={task?.id ?? "new"}
            task={task ?? null}
            assignmentAvailable={assignmentAvailable}
            initialOrder={initialOrder}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({
  task,
  assignmentAvailable,
  initialOrder,
  onDone,
}: {
  task: TaskRecord | null;
  assignmentAvailable: boolean;
  initialOrder: TaskOrderOption | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const create = useCreateTask();
  const update = useUpdateTask();
  const team = useTeamDirectory();
  const isPending = create.isPending || update.isPending;
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [assignedTo, setAssignedTo] = useState(task?.assignedTo ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "medium");
  const [dueAt, setDueAt] = useState(toDatetimeLocalValue(task?.dueAt));
  const [order, setOrder] = useState<TaskOrderOption | null>(() =>
    task?.orderId
      ? { id: task.orderId, number: task.orderNumber ?? "", clientId: task.clientId, clientName: "" }
      : initialOrder,
  );

  const needsAssignee = assignmentAvailable && !assignedTo;
  const canSubmit = Boolean(title.trim()) && !needsAssignee && !isPending;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    const input = {
      title,
      priority,
      dueAt: fromDatetimeLocalValue(dueAt),
      description,
      ...(assignmentAvailable ? { assignedTo } : {}),
      orderId: order?.id ?? null,
      clientId: order?.clientId ?? null,
    };
    if (task) update.mutate({ id: task.id, input }, { onSuccess: onDone });
    else create.mutate(input, { onSuccess: onDone });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="task-title">{t("stage9.tasks.form.titleLabel")}</Label>
          <Input
            id="task-title"
            maxLength={256}
            value={title}
            required
            autoFocus
            placeholder={t("stage9.tasks.form.titlePlaceholder")}
            disabled={isPending}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        {assignmentAvailable ? (
          <div className="space-y-1.5">
            <Label>{t("stage9.tasks.form.assignee")}</Label>
            <Select value={assignedTo} disabled={isPending || team.isLoading} onValueChange={setAssignedTo}>
              <SelectTrigger>
                <SelectValue placeholder={t("stage9.tasks.form.assigneePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {team.people.map((person) => (
                  <SelectItem key={person.userId} value={person.userId}>
                    {person.isCurrentUser ? `${person.name} (${t("stage9.tasks.me")})` : person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("stage9.tasks.form.assigneeHint")}</p>
          </div>
        ) : null}

        <TaskOrderField value={order} onChange={setOrder} disabled={isPending} />

        <div className="space-y-1.5">
          <Label htmlFor="task-description">{t("stage9.tasks.form.descriptionLabel")}</Label>
          <Textarea
            id="task-description"
            rows={3}
            maxLength={4000}
            value={description}
            placeholder={t("stage9.tasks.form.descriptionPlaceholder")}
            disabled={isPending}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="task-due">{t("stage9.tasks.dueAt")}</Label>
            <Input
              id="task-due"
              type="datetime-local"
              value={dueAt}
              disabled={isPending}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("stage9.tasks.priority")}</Label>
            <Select value={priority} disabled={isPending} onValueChange={(value) => setPriority(value as TaskPriority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {priorities.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`stage9.tasks.priorities.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={isPending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {isPending ? <Spinner className="size-4" /> : null}
          {task ? t("stage9.tasks.form.save") : t("stage9.tasks.form.submit")}
        </Button>
      </div>
    </form>
  );
}

/** Order the task is about: a chip with an unlink button, or a search by order number / plate / client. */
function TaskOrderField({
  value,
  onChange,
  disabled,
}: {
  value: TaskOrderOption | null;
  onChange: (order: TaskOrderOption | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounce(query, 250);
  const rootRef = useRef<HTMLDivElement>(null);
  const search = useQuery({
    queryKey: ["orders", workspaceId, "task-picker", debounced.trim().toLowerCase()],
    queryFn: () => searchOrdersForTask(workspaceId, debounced),
    enabled: Boolean(workspaceId) && open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="space-y-1.5" ref={rootRef}>
      <Label htmlFor="task-order">{t("stage9.tasks.form.order")}</Label>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <ClipboardList className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">
              <span className="font-medium">{value.number || t("stage9.tasks.orderFallback")}</span>
              {value.clientName ? <span className="text-muted-foreground"> · {value.clientName}</span> : null}
            </span>
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={disabled}
            aria-label={t("stage9.tasks.form.unlinkOrder")}
            onClick={() => onChange(null)}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Input
            id="task-order"
            autoComplete="off"
            value={query}
            disabled={disabled}
            placeholder={t("stage9.tasks.form.orderPlaceholder")}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
          />
          {open ? (
            <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover shadow">
              {(search.data ?? []).length === 0 ? (
                <p className="px-3 py-2.5 text-sm text-muted-foreground">
                  {search.isLoading || debounced !== query ? t("common.loading") : t("stage9.tasks.form.orderEmpty")}
                </p>
              ) : (
                (search.data ?? []).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      onChange(option);
                      setQuery("");
                      setOpen(false);
                    }}
                  >
                    <span className="font-medium tabular-nums">{option.number}</span>
                    <span className="min-w-0 truncate text-muted-foreground">{option.clientName}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("stage9.tasks.form.orderHint")}</p>
    </div>
  );
}
