import i18n from "../../i18n";
import { createTask, deleteTask, updateTask, type TaskInput } from "../../services/apiTasks";
import { useStage9Mutation } from "../stage9/useStage9Mutation";

export function useCreateTask() {
  return useStage9Mutation<TaskInput>("tasks", (input, ws) => createTask(input, ws), () => i18n.t("stage9.tasks.toast.created"));
}

export function useUpdateTask() {
  return useStage9Mutation<{ id: string; input: TaskInput }>(
    "tasks",
    ({ id, input }, ws) => updateTask(id, input, ws),
    () => i18n.t("stage9.tasks.toast.updated"),
  );
}

export function useDeleteTask() {
  return useStage9Mutation<string>("tasks", (id, ws) => deleteTask(id, ws), () => i18n.t("stage9.tasks.toast.deleted"));
}
