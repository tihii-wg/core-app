import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import { Textarea } from "../../ui/Textarea";
import type { TaskPriority, TaskRecord } from "../../services/apiTasks";
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
};

const priorities: readonly TaskPriority[] = ["high", "medium", "low"];

export function TaskFormDialog({ open, onOpenChange, task, assignmentAvailable = true }: TaskFormDialogProps) {
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
  onDone,
}: {
  task: TaskRecord | null;
  assignmentAvailable: boolean;
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
