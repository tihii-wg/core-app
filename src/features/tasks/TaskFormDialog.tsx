import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import type { TaskPriority, TaskRecord } from "../../services/apiTasks";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "../stage9/datetimeLocal";
import { useCreateTask, useUpdateTask } from "./useTaskMutations";

type TaskFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set the dialog edits this task; otherwise it creates one. */
  task?: TaskRecord | null;
};

const priorities: readonly TaskPriority[] = ["high", "medium", "low"];

export function TaskFormDialog({ open, onOpenChange, task }: TaskFormDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{task ? t("stage9.tasks.form.editTitle") : t("stage9.tasks.form.title")}</DialogTitle>
          <DialogDescription>{t("stage9.tasks.form.description")}</DialogDescription>
        </DialogHeader>
        {open ? <TaskForm key={task?.id ?? "new"} task={task ?? null} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({ task, onDone }: { task: TaskRecord | null; onDone: () => void }) {
  const { t } = useTranslation();
  const create = useCreateTask();
  const update = useUpdateTask();
  const isPending = create.isPending || update.isPending;
  const [title, setTitle] = useState(task?.title ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "medium");
  const [dueAt, setDueAt] = useState(toDatetimeLocalValue(task?.dueAt));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isPending || !title.trim()) return;
    const input = { title, priority, dueAt: fromDatetimeLocalValue(dueAt) };
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
            disabled={isPending}
            onChange={(event) => setTitle(event.target.value)}
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
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={isPending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isPending || !title.trim()}>
          {isPending ? <Spinner className="size-4" /> : null}
          {task ? t("stage9.tasks.form.save") : t("stage9.tasks.form.submit")}
        </Button>
      </div>
    </form>
  );
}
