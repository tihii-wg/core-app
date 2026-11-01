import { useQuery } from "@tanstack/react-query";
import { getBookings } from "../../services/apiBookings";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetBookings() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["bookings", workspaceId],
    queryFn: () => getBookings(workspaceId),
    enabled: Boolean(workspaceId),
  });
}
