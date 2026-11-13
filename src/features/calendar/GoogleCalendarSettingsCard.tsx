import { useEffect, useRef } from "react";
import { CalendarDays } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { useConfirm } from "../../ui/ConfirmProvider";
import { languageFromPath } from "../../i18n/languages";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useIsWorkspaceOwnerId } from "../workspaces/useIsWorkspaceOwnerId";
import {
  useConnectGoogleCalendar,
  useDisconnectGoogleCalendar,
  useGoogleCalendarStatus,
  useRefreshGoogleCalendar,
} from "./useGoogleCalendar";
import { CalendarVisibilitySettings } from "./CalendarVisibilitySettings";

/** Owner connect / status / disconnect block for Settings → Storage. */
export function GoogleCalendarSettingsCard() {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const isOwner = useIsWorkspaceOwnerId();
  const { workspaceId } = useActiveWorkspaceId();
  const statusQuery = useGoogleCalendarStatus(true);
  const connect = useConnectGoogleCalendar();
  const disconnect = useDisconnectGoogleCalendar();
  const refresh = useRefreshGoogleCalendar();
  const handledOauth = useRef<string | null>(null);

  const status = statusQuery.data;
  const connected = Boolean(status?.connected);
  const busy = connect.isPending || disconnect.isPending;
  const locale = languageFromPath(window.location.pathname) || i18n.language || "en";

  useEffect(() => {
    const gcal = searchParams.get("gcal");
    const gcalError = searchParams.get("gcal_error");
    if (gcal !== "connected" && !gcalError) return;
    // Calendar page is the primary landing; ignore if already on calendar route handler.
    if (window.location.pathname.includes("/calendar")) return;
    const marker = gcalError ? `err:${gcalError}` : "connected";
    if (handledOauth.current !== marker) {
      handledOauth.current = marker;
      if (gcal === "connected") toast.success(t("calendar.toast.connected"));
      else {
        toast.error(
          gcalError ? t("calendar.toast.oauthError", { code: gcalError }) : t("calendar.toast.oauthErrorGeneric"),
        );
      }
      void refresh();
    }
    const next = new URLSearchParams(searchParams);
    next.delete("gcal");
    next.delete("gcal_error");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function onDisconnect() {
    if (!isOwner || busy) return;
    const ok = await confirm({
      title: t("calendar.confirmDisconnect.title"),
      description: t("calendar.confirmDisconnect.description"),
      confirmLabel: t("calendar.confirmDisconnect.confirm"),
      tone: "destructive",
      icon: "warning",
    });
    if (!ok) return;
    disconnect.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="size-4" />
          {t("calendar.settings.title")}
        </CardTitle>
        <CardDescription>{t("calendar.settings.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">
          {connected
            ? t("calendar.settings.statusConnected", {
                email: status?.googleEmail ?? "—",
                calendar: status?.calendarSummary ?? "—",
              })
            : status?.reconnectRequired
              ? t("calendar.reconnectRequired")
              : t("calendar.settings.statusDisconnected")}
        </p>
        <div className="flex flex-wrap gap-2">
          {workspaceId ? (
            <Button asChild size="sm" variant="outline">
              <Link to={`/${locale}/${workspaceId}/calendar`}>{t("calendar.settings.openCalendar")}</Link>
            </Button>
          ) : null}
          {isOwner ? (
            connected ? (
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => void onDisconnect()}>
                {t("calendar.disconnect")}
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => connect.mutate(i18n.language || "en")}>
                {status?.reconnectRequired ? t("calendar.reconnect") : t("calendar.connect")}
              </Button>
            )
          ) : null}
        </div>
        {isOwner && connected ? <CalendarVisibilitySettings /> : null}
      </CardContent>
    </Card>
  );
}
