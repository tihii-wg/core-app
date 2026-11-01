import { useQuery } from "@tanstack/react-query";
import { getDocumentTemplates } from "../../services/apiDocumentTemplates";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetDocumentTemplates() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["document-templates", workspaceId],
    queryFn: () => getDocumentTemplates(workspaceId),
    enabled: Boolean(workspaceId),
  });
}
