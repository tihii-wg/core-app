import { useQuery } from "@tanstack/react-query";
import { getMessageTemplates } from "../../services/apiMessageTemplates";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetMessageTemplates() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["message-templates", workspaceId],
    queryFn: () => getMessageTemplates(workspaceId),
    enabled: Boolean(workspaceId),
  });
}
