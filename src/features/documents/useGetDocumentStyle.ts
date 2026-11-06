import { useQuery } from "@tanstack/react-query";
import { defaultDocumentStyle } from "./documentStyle";
import { DOCUMENT_STYLE_TYPE, resolveDocumentStyle } from "../../services/apiDocumentTemplates";
import { useGetDocumentTemplates } from "./useGetDocumentTemplates";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

/** React-query cache of the workspace DocumentStyle (falls back to built-in default). */
export function useGetDocumentStyle() {
  const { workspaceId } = useActiveWorkspaceId();
  const templatesQuery = useGetDocumentTemplates();

  return useQuery({
    queryKey: ["document-style", workspaceId, templatesQuery.dataUpdatedAt],
    queryFn: () => {
      const row = (templatesQuery.data ?? []).find(
        (template) => template.documentType === DOCUMENT_STYLE_TYPE && template.isActive,
      );
      return resolveDocumentStyle(row?.style ?? null);
    },
    enabled: Boolean(workspaceId) && !templatesQuery.isLoading,
    initialData: () => {
      const row = (templatesQuery.data ?? []).find(
        (template) => template.documentType === DOCUMENT_STYLE_TYPE && template.isActive,
      );
      return row?.style ? resolveDocumentStyle(row.style) : defaultDocumentStyle();
    },
    staleTime: 30_000,
  });
}
