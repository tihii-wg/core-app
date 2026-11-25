import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { getProblemFlags, setClientProblem } from "../../services/apiProblemClients";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function problemClientQueryKey(workspaceId: string | undefined, clientId: string) {
  return ["problem-client", workspaceId, clientId] as const;
}

/**
 * Batches the flag lookups of every client name rendered in the same tick (one page of a list) into one
 * request for exactly those clients; each flag is then cached per client.
 */
const pending = new Map<string, { ids: Set<string>; waiters: Array<{ id: string; resolve: (v: boolean) => void; reject: (e: unknown) => void }> }>();

function loadProblemFlag(workspaceId: string, clientId: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let batch = pending.get(workspaceId);
    if (!batch) {
      batch = { ids: new Set(), waiters: [] };
      pending.set(workspaceId, batch);
      setTimeout(() => {
        const current = pending.get(workspaceId);
        pending.delete(workspaceId);
        if (!current) return;
        getProblemFlags(workspaceId, [...current.ids]).then(
          (flags) => current.waiters.forEach((w) => w.resolve(flags.get(w.id) === true)),
          (error) => current.waiters.forEach((w) => w.reject(error)),
        );
      }, 0);
    }
    batch.ids.add(clientId);
    batch.waiters.push({ id: clientId, resolve, reject });
  });
}

export function useIsProblemClient(clientId: string | null | undefined): boolean {
  const { workspaceId } = useActiveWorkspaceId();
  const id = clientId?.trim() ?? "";
  const { data } = useQuery({
    queryKey: problemClientQueryKey(workspaceId, id),
    queryFn: () => loadProblemFlag(workspaceId!, id),
    enabled: Boolean(workspaceId && id),
    staleTime: 5 * 60_000,
  });
  return data === true;
}

export function useSetClientProblem() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: ({ clientId, isProblem }: { clientId: string; isProblem: boolean }) =>
      setClientProblem(workspaceId!, clientId, isProblem),
    onMutate: ({ clientId, isProblem }) => {
      // Show / hide the mark at once everywhere this client is on screen.
      const key = problemClientQueryKey(workspaceId, clientId);
      const previous = queryClient.getQueryData<boolean>(key);
      queryClient.setQueryData(key, isProblem);
      return { previous };
    },
    onError: (error: Error, { clientId }, context) => {
      queryClient.setQueryData(problemClientQueryKey(workspaceId, clientId), context?.previous ?? false);
      toast.error(error.message || i18n.t("common.somethingWentWrong"));
    },
    onSuccess: (_data, { isProblem }) => {
      toast.success(i18n.t(isProblem ? "clients.problem.marked" : "clients.problem.unmarked"), { id: "client-problem" });
    },
  });
}
