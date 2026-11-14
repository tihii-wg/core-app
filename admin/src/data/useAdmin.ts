import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getWorkspace, listAudit, listWorkspaces, setSubscription, type SetSubscriptionInput } from "./adminApi";

export const adminKeys = {
  workspaces: ["admin", "workspaces"] as const,
  workspace: (id: string) => ["admin", "workspace", id] as const,
  audit: (id?: string) => ["admin", "audit", id ?? "all"] as const,
};

export function useWorkspaces() {
  return useQuery({ queryKey: adminKeys.workspaces, queryFn: listWorkspaces, staleTime: 30_000 });
}

export function useWorkspace(id: string | undefined) {
  return useQuery({
    queryKey: adminKeys.workspace(id ?? ""),
    queryFn: () => getWorkspace(id as string),
    enabled: Boolean(id),
  });
}

export function useAudit(workspaceId?: string) {
  return useQuery({ queryKey: adminKeys.audit(workspaceId), queryFn: () => listAudit(workspaceId) });
}

export function useSetSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetSubscriptionInput) => setSubscription(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.workspaces }),
        queryClient.invalidateQueries({ queryKey: adminKeys.workspace(input.workspaceId) }),
        queryClient.invalidateQueries({ queryKey: ["admin", "audit"] }),
      ]);
    },
  });
}
