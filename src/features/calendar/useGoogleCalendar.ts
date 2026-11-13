import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  disconnectGoogleCalendar,
  getGoogleCalendarStatus,
  listGoogleCalendarEvents,
  listGoogleCalendars,
  selectGoogleCalendar,
  startGoogleCalendarOAuth,
  updateGoogleCalendarEvent,
  updateGoogleCalendarSettings,
  type UpsertGoogleCalendarEventInput,
} from "../../services/apiGoogleCalendar";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function googleCalendarStatusKey(workspaceId: string | undefined) {
  return ["google-calendar-status", workspaceId] as const;
}

export function googleCalendarEventsKey(workspaceId: string | undefined, from: string, to: string) {
  return ["google-calendar-events", workspaceId, from, to] as const;
}

export function googleCalendarListKey(workspaceId: string | undefined) {
  return ["google-calendar-list", workspaceId] as const;
}

export function useGoogleCalendarStatus(enabled = true) {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: googleCalendarStatusKey(workspaceId),
    queryFn: () => getGoogleCalendarStatus(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
    retry: false,
  });
}

export function useGoogleCalendarEvents(from: string, to: string, enabled = true) {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: googleCalendarEventsKey(workspaceId, from, to),
    queryFn: () => listGoogleCalendarEvents(workspaceId, from, to),
    enabled: Boolean(workspaceId) && Boolean(from) && Boolean(to) && enabled,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
      return query.state.data ? 60_000 : false;
    },
    retry: false,
  });
}

export function useGoogleCalendarList(enabled = false) {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: googleCalendarListKey(workspaceId),
    queryFn: () => listGoogleCalendars(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
    retry: false,
  });
}

export function useRefreshGoogleCalendar() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: googleCalendarStatusKey(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: ["google-calendar-events", workspaceId] }),
      queryClient.invalidateQueries({ queryKey: googleCalendarListKey(workspaceId) }),
    ]);
  };
}

export function useConnectGoogleCalendar() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: (locale: string) => startGoogleCalendarOAuth(workspaceId, locale),
    onSuccess: (url) => {
      window.location.assign(url);
    },
    onError: (error: Error) => {
      toast.error(error.message || t("calendar.errors.connectFailed"));
    },
  });
}

export function useDisconnectGoogleCalendar() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const refresh = useRefreshGoogleCalendar();
  return useMutation({
    mutationFn: () => disconnectGoogleCalendar(workspaceId),
    onSuccess: async () => {
      await refresh();
      toast.success(t("calendar.toast.disconnected"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("calendar.errors.disconnectFailed"));
    },
  });
}

export function useSelectGoogleCalendar() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const refresh = useRefreshGoogleCalendar();
  return useMutation({
    mutationFn: (calendarId: string) => selectGoogleCalendar(workspaceId, calendarId),
    onSuccess: async () => {
      await refresh();
      toast.success(t("calendar.toast.calendarSelected"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("calendar.errors.selectFailed"));
    },
  });
}

export function useUpdateGoogleCalendarSettings() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const refresh = useRefreshGoogleCalendar();
  return useMutation({
    mutationFn: (input: {
      teamAccess?: boolean;
      syncOrders?: boolean;
      syncMeasurement?: boolean;
      syncInstallation?: boolean;
    }) => updateGoogleCalendarSettings(workspaceId, input),
    onSuccess: async () => {
      await refresh();
      toast.success(t("calendar.toast.settingsSaved"));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("calendar.errors.saveFailed"));
    },
  });
}

export function useCreateGoogleCalendarEvent() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const refresh = useRefreshGoogleCalendar();
  return useMutation({
    mutationFn: (input: UpsertGoogleCalendarEventInput) => createGoogleCalendarEvent(workspaceId, input),
    onSuccess: async () => {
      await refresh();
      toast.success(t("calendar.toast.saved"));
    },
    onError: (error: Error & { code?: string }) => {
      if (error.code === "reconnect_required") {
        toast.error(t("calendar.errors.reconnectRequired"));
        return;
      }
      toast.error(error.message || t("calendar.errors.saveFailed"));
    },
  });
}

export function useUpdateGoogleCalendarEvent() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const refresh = useRefreshGoogleCalendar();
  return useMutation({
    mutationFn: ({ eventId, input }: { eventId: string; input: UpsertGoogleCalendarEventInput & { etag: string } }) =>
      updateGoogleCalendarEvent(workspaceId, eventId, input),
    onSuccess: async () => {
      await refresh();
    },
    onError: (error: Error & { code?: string }) => {
      if (error.code === "conflict") {
        void refresh();
        toast.error(t("calendar.errors.conflict"));
        return;
      }
      if (error.code === "reconnect_required") {
        toast.error(t("calendar.errors.reconnectRequired"));
        return;
      }
      toast.error(error.message || t("calendar.errors.saveFailed"));
    },
  });
}

export function useDeleteGoogleCalendarEvent() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const refresh = useRefreshGoogleCalendar();
  return useMutation({
    mutationFn: (eventId: string) => deleteGoogleCalendarEvent(workspaceId, eventId),
    onSuccess: async () => {
      await refresh();
      toast.success(t("calendar.toast.deleted"));
    },
    onError: (error: Error & { code?: string }) => {
      if (error.code === "reconnect_required") {
        toast.error(t("calendar.errors.reconnectRequired"));
        return;
      }
      toast.error(error.message || t("calendar.errors.deleteFailed"));
    },
  });
}
