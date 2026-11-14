import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { createTask, deleteTask, setTaskState, updateTask, type TaskInput, type TaskState } from "../../services/apiTasks";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useStage9Mutation } from "../stage9/useStage9Mutation";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

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

/** Done / in progress / back to todo. The server re-checks author/assignee rights. */
export function useSetTaskState() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: ({ id, state }: { id: string; state: TaskState }) => {
      guardWrite();
      return setTaskState(id, state);
    },
    onSuccess: (_data, { state }) => {
      void queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] });
      toast.success(i18n.t(state === "done" ? "stage9.tasks.toast.done" : "stage9.tasks.toast.reopened"));
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}
