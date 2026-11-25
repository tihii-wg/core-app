import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { getProblemClientIds, setClientProblem } from "../../services/apiProblemClients";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function problemClientsQueryKey(workspaceId: string | undefined) {
  return ["problem-clients", workspaceId] as const;
}

const EMPTY = new Set<string>();

/**
 * Flagged («problem») clients of the active workspace. Every name renderer shares this one cached query,
 * so marking names across lists costs one small request per workspace.
 */
export function useProblemClientIds() {
  const { workspaceId } = useActiveWorkspaceId();
  const { data } = useQuery({
    queryKey: problemClientsQueryKey(workspaceId),
    queryFn: () => getProblemClientIds(workspaceId!),
    enabled: Boolean(workspaceId),
    staleTime: 5 * 60_000,
  });
  return data ?? EMPTY;
}

export function useIsProblemClient(clientId: string | null | undefined): boolean {
  const ids = useProblemClientIds();
  const id = clientId?.trim();
  return Boolean(id && ids.has(id));
}

export function useSetClientProblem() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: ({ clientId, isProblem }: { clientId: string; isProblem: boolean }) =>
      setClientProblem(workspaceId!, clientId, isProblem),
    onMutate: ({ clientId, isProblem }) => {
      // Show the mark at once everywhere.
      const key = problemClientsQueryKey(workspaceId);
      const previous = queryClient.getQueryData<Set<string>>(key);
      const next = new Set(previous ?? []);
      if (isProblem) next.add(clientId);
      else next.delete(clientId);
      queryClient.setQueryData(key, next);
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      queryClient.setQueryData(problemClientsQueryKey(workspaceId), context?.previous);
      toast.error(error.message || i18n.t("common.somethingWentWrong"));
    },
    onSuccess: (_data, { isProblem }) => {
      toast.success(i18n.t(isProblem ? "clients.problem.marked" : "clients.problem.unmarked"), { id: "client-problem" });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: problemClientsQueryKey(workspaceId), exact: true });
    },
  });
}
