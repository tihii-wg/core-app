import { useQuery } from "@tanstack/react-query";
import { getClient } from "../../services/apiClients";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function clientQueryKey(workspaceId: string | undefined, clientId: string) {
  return ["clients", workspaceId, "id", clientId] as const;
}

export function useGetClient(clientId: string | null | undefined) {
  const { workspaceId } = useActiveWorkspaceId();
  const id = clientId?.trim() ?? "";

  const query = useQuery({
    queryKey: clientQueryKey(workspaceId, id),
    queryFn: () => getClient(workspaceId, id),
    enabled: Boolean(workspaceId && id),
  });

  return {
    client: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    notFound: Boolean(workspaceId && id && query.isFetched && !query.isError && query.data == null),
    refetch: query.refetch,
  };
}
