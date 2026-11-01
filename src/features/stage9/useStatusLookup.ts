import { useMemo } from "react";
import { useGetStatusDefinitions } from "../statuses/useGetStatusDefinitions";

/** Resolves `status_id` to the workspace status name/color (empty map when `status_definitions` is unavailable). */
export function useStatusLookup() {
  const { data: statuses = [] } = useGetStatusDefinitions();
  return useMemo(() => new Map(statuses.map((status) => [status.id, status])), [statuses]);
}

export type StatusLookup = ReturnType<typeof useStatusLookup>;
