import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BellRing, Send, Unlink } from "lucide-react";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Switch } from "../../ui/Switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Skeleton } from "../../ui/Skeleton";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import {
  NOTIFICATION_EVENT_GROUPS,
  RECOMMENDED_EVENTS,
  TelegramNotificationsUnavailableError,
  eventSupportsScope,
  type NotificationEvent,
  type NotificationEventGroup,
  type NotificationScope,
  type NotificationSubscription,
} from "../../services/apiTelegramNotifications";
import {
  useConnectTelegram,
  useNotificationSubscriptions,
  useSaveNotificationSubscriptions,
  useTelegramLink,
  useUnlinkTelegram,
} from "../notifications/useTelegramNotifications";

const WAIT_FOR_LINK_MS = 3 * 60_000;

export function TelegramNotificationsSettings() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const [waitingUntil, setWaitingUntil] = useState<number | null>(null);
  const waiting = waitingUntil != null && Date.now() < waitingUntil;

  const linkQuery = useTelegramLink(waiting);
  const subscriptionsQuery = useNotificationSubscriptions();
  const save = useSaveNotificationSubscriptions();
  const connect = useConnectTelegram();
  const unlink = useUnlinkTelegram();

  const link = linkQuery.data ?? null;
  const linked = Boolean(link?.isActive);

  // Stop polling once linked or after the wait window.
  useEffect(() => {
    if (!waitingUntil) return;
    if (linked) {
      setWaitingUntil(null);
      return;
    }
    const timer = window.setTimeout(() => setWaitingUntil(null), Math.max(0, waitingUntil - Date.now()));
    return () => window.clearTimeout(timer);
  }, [waitingUntil, linked]);

  const unavailable =
    linkQuery.error instanceof TelegramNotificationsUnavailableError ||
    subscriptionsQuery.error instanceof TelegramNotificationsUnavailableError;

  const subscriptions = new Map<NotificationEvent, NotificationSubscription>(
    (subscriptionsQuery.data ?? []).map((item) => [item.event, item]),
  );
  const current = (event: NotificationEvent): NotificationSubscription =>
    subscriptions.get(event) ?? { event, enabled: false, scope: "all" };

  async function onConnect() {
    // Open the tab synchronously (popup blockers), then point it at the one-time bot link.
    const popup = window.open("about:blank", "_blank");
    try {
      const url = await connect.mutateAsync();
      if (popup) popup.location.href = url;
      else window.location.href = url;
      setWaitingUntil(Date.now() + WAIT_FOR_LINK_MS);
    } catch {
      popup?.close();
    }
  }

  function toggle(event: NotificationEvent, enabled: boolean) {
    save.mutate([{ ...current(event), enabled }]);
  }

  function setScope(event: NotificationEvent, scope: NotificationScope) {
    save.mutate([{ ...current(event), scope }]);
  }

  function enableRecommended() {
    save.mutate(RECOMMENDED_EVENTS.map((event) => ({ ...current(event), enabled: true })));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("settings.telegram.title")}
        </CardTitle>
        <CardDescription>{t("settings.telegram.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {unavailable ? (
          <p className="text-sm text-muted-foreground">{t("settings.telegram.errors.unavailable")}</p>
        ) : linkQuery.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              {linked ? (
                <>
                  <p className="text-sm font-medium text-foreground">{t("settings.telegram.connected")}</p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {link?.username ? `@${link.username}` : link?.firstName ?? ""}
                  </p>
                </>
              ) : link && !link.isActive ? (
                <>
                  <p className="text-sm font-medium text-destructive">{t("settings.telegram.blockedTitle")}</p>
                  <p className="text-[13px] text-muted-foreground">{t("settings.telegram.blockedHint")}</p>
                </>
              ) : waiting ? (
                <>
                  <p className="text-sm font-medium text-foreground">{t("settings.telegram.waitingTitle")}</p>
                  <p className="text-[13px] text-muted-foreground">{t("settings.telegram.waitingHint")}</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-foreground">{t("settings.telegram.notConnected")}</p>
                  <p className="text-[13px] text-muted-foreground">{t("settings.telegram.connectHint")}</p>
                </>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              {linked ? (
                <Button type="button" variant="outline" onClick={() => unlink.mutate()} disabled={unlink.isPending}>
                  <Unlink className="size-4" aria-hidden="true" />
                  {t("settings.telegram.disconnect")}
                </Button>
              ) : (
                <Button type="button" onClick={() => void onConnect()} disabled={connect.isPending}>
                  <Send className="size-4" aria-hidden="true" />
                  {t("settings.telegram.connect")}
                </Button>
              )}
            </div>
          </div>
        )}

        {!unavailable ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] text-muted-foreground">
                {t("settings.telegram.workspaceScope", { name: workspace?.name ?? "" })}
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={enableRecommended} disabled={save.isPending}>
                <BellRing className="size-4" aria-hidden="true" />
                {t("settings.telegram.enableRecommended")}
              </Button>
            </div>

            {subscriptionsQuery.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              (Object.keys(NOTIFICATION_EVENT_GROUPS) as NotificationEventGroup[]).map((group) => (
                <div key={group} className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t(`settings.telegram.groups.${group}`)}
                  </p>
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {NOTIFICATION_EVENT_GROUPS[group].map((event) => {
                      const sub = current(event);
                      const id = `tg-event-${event}`;
                      return (
                        <div key={event} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <label htmlFor={id} className="text-sm font-medium text-foreground">
                              {t(`settings.telegram.events.${event}.label`)}
                            </label>
                            <p className="text-[13px] text-muted-foreground">
                              {t(`settings.telegram.events.${event}.description`)}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            {eventSupportsScope(event) ? (
                              <Select
                                value={sub.scope}
                                onValueChange={(value) => setScope(event, value === "mine" ? "mine" : "all")}
                                disabled={!sub.enabled || save.isPending}
                              >
                                <SelectTrigger className="h-8 w-40" aria-label={t("settings.telegram.scopeLabel")}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">{t("settings.telegram.scope.all")}</SelectItem>
                                  <SelectItem value="mine">{t("settings.telegram.scope.mine")}</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : null}
                            <Switch
                              id={id}
                              checked={sub.enabled}
                              onCheckedChange={(value) => toggle(event, value)}
                              aria-label={t(`settings.telegram.events.${event}.label`)}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
            {!linked ? <p className="text-[13px] text-muted-foreground">{t("settings.telegram.notLinkedNote")}</p> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
