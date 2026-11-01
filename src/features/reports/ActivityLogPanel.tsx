import { Activity, Download } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Skeleton } from "../../ui/Skeleton";
import { activityLogCsv } from "./csvExport";
import { downloadCsv, useReportFormatting } from "./reportFormatting";
import { useGetActivityLog } from "./useGetActivityLog";

/** Read-only list of the latest `activity_log` rows. Degrades to an empty state when the table is not applied. */
export function ActivityLogPanel() {
  const { t } = useTranslation();
  const { formatDateTime } = useReportFormatting();
  const { data, isLoading, error } = useGetActivityLog();
  const entries = data?.entries ?? [];

  const exportCsv = () => {
    downloadCsv(`activity-log_${new Date().toISOString().slice(0, 10)}.csv`, activityLogCsv(entries, formatDateTime));
    toast.success(t("reports.toast.exported"), { id: "export-activity" });
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Activity aria-hidden="true" className="size-4 text-subtle-foreground" />
            {t("reports.activity.title")}
          </CardTitle>
          <CardDescription>{t("reports.activity.description")}</CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={entries.length === 0} onClick={exportCsv}>
          <Download />
          {t("reports.activity.exportCsv")}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : error ? (
          <p className="text-sm text-destructive">{error instanceof Error ? error.message : t("reports.charts.loadError")}</p>
        ) : data?.isUnavailable ? (
          <p className="text-sm text-muted-foreground">{t("reports.activity.unavailable")}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("reports.activity.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-2 py-2 text-left font-medium">{t("reports.activity.columns.when")}</th>
                  <th className="px-2 py-2 text-left font-medium">{t("reports.activity.columns.actor")}</th>
                  <th className="px-2 py-2 text-left font-medium">{t("reports.activity.columns.entity")}</th>
                  <th className="px-2 py-2 text-left font-medium">{t("reports.activity.columns.event")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((entry) => {
                  const date = entry.createdAt ? new Date(entry.createdAt) : null;
                  return (
                    <tr key={entry.id}>
                      <td className="px-2 py-2.5 whitespace-nowrap text-muted-foreground tabular-nums">
                        {date && !Number.isNaN(date.getTime()) ? formatDateTime(date) : "—"}
                      </td>
                      <td className="px-2 py-2.5 text-foreground">{entry.actorName ?? t("reports.activity.system")}</td>
                      <td className="px-2 py-2.5 text-muted-foreground">{entry.entityType}</td>
                      <td className="px-2 py-2.5 font-medium text-foreground">{entry.event}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
