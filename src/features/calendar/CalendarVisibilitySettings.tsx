import { useTranslation } from "react-i18next";
import { Switch } from "../../ui/Switch";
import { Label } from "../../ui/Label";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useUpdateGoogleCalendarSettings, useGoogleCalendarStatus } from "./useGoogleCalendar";

/** Owner toggles: team visibility + order date sync. */
export function CalendarVisibilitySettings() {
  const { t } = useTranslation();
  const { profile } = useIndustryWorkflow();
  const statusQuery = useGoogleCalendarStatus();
  const update = useUpdateGoogleCalendarSettings();
  const status = statusQuery.data;
  if (!status?.connected) return null;

  const showMeasurement = Boolean(profile?.orderFieldBlocks?.measurementAt);
  const showInstallation = Boolean(profile?.orderFieldBlocks?.installationAt);
  const busy = update.isPending;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-muted-foreground text-xs">{t("calendar.settings.visibilityHint")}</p>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="gcal-team">{t("calendar.settings.teamAccess")}</Label>
        <Switch
          id="gcal-team"
          checked={Boolean(status.teamAccess)}
          disabled={busy}
          onCheckedChange={(teamAccess) => update.mutate({ teamAccess })}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="gcal-sync-orders">{t("calendar.settings.syncOrders")}</Label>
        <Switch
          id="gcal-sync-orders"
          checked={Boolean(status.syncOrders)}
          disabled={busy}
          onCheckedChange={(syncOrders) => update.mutate({ syncOrders })}
        />
      </div>
      {status.syncOrders && showMeasurement ? (
        <div className="flex items-center justify-between gap-3 pl-2">
          <Label htmlFor="gcal-sync-measure">{t("calendar.settings.syncMeasurement")}</Label>
          <Switch
            id="gcal-sync-measure"
            checked={Boolean(status.syncMeasurement)}
            disabled={busy}
            onCheckedChange={(syncMeasurement) => update.mutate({ syncMeasurement })}
          />
        </div>
      ) : null}
      {status.syncOrders && showInstallation ? (
        <div className="flex items-center justify-between gap-3 pl-2">
          <Label htmlFor="gcal-sync-install">{t("calendar.settings.syncInstallation")}</Label>
          <Switch
            id="gcal-sync-install"
            checked={Boolean(status.syncInstallation)}
            disabled={busy}
            onCheckedChange={(syncInstallation) => update.mutate({ syncInstallation })}
          />
        </div>
      ) : null}
      {status.lastSyncError ? (
        <p className="text-destructive text-xs">{t("calendar.settings.syncError", { error: status.lastSyncError })}</p>
      ) : null}
      {typeof status.pendingSyncCount === "number" && status.pendingSyncCount > 0 ? (
        <p className="text-muted-foreground text-xs">
          {t("calendar.settings.pendingSync", { count: status.pendingSyncCount })}
        </p>
      ) : null}
    </div>
  );
}
