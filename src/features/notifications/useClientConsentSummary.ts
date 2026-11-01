import { useQuery } from "@tanstack/react-query";
import { getClientConsentSummary } from "../../services/apiClientConsent";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useClientConsentSummary() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["client-consent-summary", workspaceId],
    queryFn: () => getClientConsentSummary(workspaceId),
    enabled: Boolean(workspaceId),
    retry: false,
  });
}
