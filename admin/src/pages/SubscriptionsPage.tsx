import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { DataSourceBanner } from "@/components/DataSourceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { UnavailablePanel } from "@/components/UnavailablePanel";
import { Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { DEMO_WORKSPACES } from "@/data/demoWorkspaces";
import { demoPlanLabels, subscriptionStatuses, type DemoPlanLabel, type SubscriptionStatus } from "@/data/types";
import { fetchAdminWorkspacesLive } from "@/data/workspaceAdminApi";
import { useT } from "@/i18n/I18nProvider";
import { formatDate } from "@/lib/format";
import { useLayoutPreview } from "@/state/LayoutPreviewContext";

export function SubscriptionsPage() {
  const t = useT();
  const { showDemoLayoutPreview } = useLayoutPreview();
  const liveQuery = useQuery({
    queryKey: ["admin", "workspaces", "live"],
    queryFn: fetchAdminWorkspacesLive,
  });

  const [status, setStatus] = useState<"all" | SubscriptionStatus>("all");
  const [plan, setPlan] = useState<"all" | DemoPlanLabel>("all");

  const sourceRows = showDemoLayoutPreview ? DEMO_WORKSPACES : [];

  const rows = useMemo(
    () =>
      sourceRows.filter((row) => {
        if (status !== "all" && row.subscriptionStatus !== status) return false;
        if (plan !== "all" && row.planLabel !== plan) return false;
        return true;
      }),
    [plan, sourceRows, status],
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t("subscriptions.title")} description={t("subscriptions.description")} />
      <DataSourceBanner />

      {liveQuery.isLoading ? <Skeleton className="h-28 w-full" /> : null}

      {liveQuery.data && !liveQuery.data.isLiveAuthorized ? (
        <UnavailablePanel title={t("unavailable.subscriptionsTitle")} description={t(liveQuery.data.reasonKey)} />
      ) : null}

      {!showDemoLayoutPreview ? (
        <EmptyState title={t("subscriptions.emptyLiveTitle")} description={t("subscriptions.emptyLiveBody")} />
      ) : (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--warning)]">
            {t("common.demoPreviewBanner")}
          </p>
          <Card className="flex flex-col gap-3 p-4 sm:flex-row">
            <label className="space-y-1.5 text-sm sm:w-48">
              <span className="font-medium">{t("common.status")}</span>
              <select
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[var(--fg)]"
                value={status}
                onChange={(event) => setStatus(event.target.value as "all" | SubscriptionStatus)}
              >
                <option value="all">{t("common.allStatuses")}</option>
                {subscriptionStatuses.map((value) => (
                  <option key={value} value={value}>
                    {t(`status.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-sm sm:w-48">
              <span className="font-medium">{t("subscriptions.planDemo")}</span>
              <select
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[var(--fg)]"
                value={plan}
                onChange={(event) => setPlan(event.target.value as "all" | DemoPlanLabel)}
              >
                <option value="all">{t("common.allPlans")}</option>
                {demoPlanLabels.map((value) => (
                  <option key={value} value={value}>
                    {t(`plan.${value}`)}
                  </option>
                ))}
              </select>
            </label>
          </Card>

          {rows.length === 0 ? (
            <EmptyState title={t("subscriptions.emptyDemoTitle")} description={t("subscriptions.emptyDemoBody")} />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--bg)_65%,var(--bg-elevated))] text-xs uppercase tracking-wide text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t("subscriptions.colWorkspace")}</th>
                      <th className="px-4 py-3 font-medium">{t("subscriptions.colPlan")}</th>
                      <th className="px-4 py-3 font-medium">{t("subscriptions.colStatus")}</th>
                      <th className="px-4 py-3 font-medium">{t("subscriptions.colStarted")}</th>
                      <th className="px-4 py-3 font-medium">{t("subscriptions.colExpires")}</th>
                      <th className="px-4 py-3 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-4 py-3">
                          <div className="font-medium">{row.name}</div>
                          <div className="text-xs text-[var(--muted)]">{row.ownerEmail}</div>
                        </td>
                        <td className="px-4 py-3">{t(`plan.${row.planLabel}`)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={row.subscriptionStatus} />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDate(row.subscriptionStartedAt)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDate(row.subscriptionExpiresAt)}</td>
                        <td className="px-4 py-3">
                          <Link className="text-[var(--primary)] underline-offset-2 hover:underline" to={`/workspaces/${row.id}`}>
                            {t("common.open")}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
