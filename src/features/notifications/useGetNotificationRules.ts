import { useQuery } from "@tanstack/react-query";
import { getNotificationRules } from "../../services/apiNotificationRules";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetNotificationRules() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["notification-rules", workspaceId],
    queryFn: () => getNotificationRules(workspaceId),
    enabled: Boolean(workspaceId),
  });
}
