import { googleCalendarStatusKey } from "./useGoogleCalendar";
import { pokeGoogleCalendarSync, type GoogleCalendarConnection } from "../../services/apiGoogleCalendar";
import type { QueryClient } from "@tanstack/react-query";

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Debounced fire-and-forget poke after order mutations.
 * Only runs when cached calendar status says syncOrders is on. Never throws / toasts.
 */
export function notifyOrderCalendarChanged(
  queryClient: QueryClient | null | undefined,
  workspaceId: string | undefined,
) {
  const id = (workspaceId ?? "").trim();
  if (!id || !queryClient) return;

  const status = queryClient.getQueryData<GoogleCalendarConnection>(googleCalendarStatusKey(id));
  if (!status?.syncOrders || !status.connected) return;

  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void pokeGoogleCalendarSync(id).catch(() => {
        // Intentional: never block order UX.
      });
    }, 2000),
  );
}
