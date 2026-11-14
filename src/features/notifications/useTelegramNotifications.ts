import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  createTelegramConnectUrl,
  getNotificationSubscriptions,
  getTelegramLink,
  saveNotificationSubscriptions,
  unlinkTelegram,
  type NotificationSubscription,
} from "../../services/apiTelegramNotifications";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export const telegramLinkKey = ["telegram-link"] as const;

/** `waitingForLink` polls every 3 s while the user is completing /start in Telegram. */
export function useTelegramLink(waitingForLink = false) {
  return useQuery({
    queryKey: telegramLinkKey,
    queryFn: getTelegramLink,
    refetchInterval: waitingForLink ? 3000 : false,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useNotificationSubscriptions() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["notification-subscriptions", workspaceId],
    queryFn: () => getNotificationSubscriptions(workspaceId),
    enabled: Boolean(workspaceId),
    retry: false,
  });
}

export function useSaveNotificationSubscriptions() {
  const { workspaceId } = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const key = ["notification-subscriptions", workspaceId];
  return useMutation({
    mutationFn: (changes: NotificationSubscription[]) => saveNotificationSubscriptions(workspaceId, changes),
    onMutate: async (changes) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationSubscription[]>(key);
      const map = new Map((previous ?? []).map((item) => [item.event, item]));
      for (const change of changes) map.set(change.event, change);
      queryClient.setQueryData(key, [...map.values()]);
      return { previous };
    },
    onError: (error, _changes, context) => {
      queryClient.setQueryData(key, context?.previous);
      toast.error(error instanceof Error ? error.message : i18n.t("common.somethingWentWrong"));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useConnectTelegram() {
  return useMutation({
    mutationFn: createTelegramConnectUrl,
    onError: (error) => toast.error(error instanceof Error ? error.message : i18n.t("common.somethingWentWrong")),
  });
}

export function useUnlinkTelegram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: unlinkTelegram,
    onSuccess: () => {
      queryClient.setQueryData(telegramLinkKey, null);
      toast.success(i18n.t("settings.telegram.toast.disconnected"));
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : i18n.t("common.somethingWentWrong")),
  });
}
