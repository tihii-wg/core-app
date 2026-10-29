import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { DataSourceBanner } from "@/components/DataSourceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { UnavailablePanel } from "@/components/UnavailablePanel";
import { Button, Card, EmptyState, Input, PageHeader, Skeleton } from "@/components/ui";
import { DEMO_WORKSPACES } from "@/data/demoWorkspaces";
import { subscriptionStatuses, type SubscriptionStatus } from "@/data/types";
import { fetchAdminWorkspacesLive } from "@/data/workspaceAdminApi";
import { useT } from "@/i18n/I18nProvider";
import { formatCount, formatDate } from "@/lib/format";
import { useLayoutPreview } from "@/state/LayoutPreviewContext";

const PAGE_SIZE = 10;

export function WorkspacesPage() {
  const t = useT();
  const { showDemoLayoutPreview } = useLayoutPreview();
  const liveQuery = useQuery({
    queryKey: ["admin", "workspaces", "live"],
    queryFn: fetchAdminWorkspacesLive,
  });

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | SubscriptionStatus>("all");
  const [page, setPage] = useState(0);

  const sourceRows = showDemoLayoutPreview ? DEMO_WORKSPACES : [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sourceRows.filter((row) => {
      if (status !== "all" && row.subscriptionStatus !== status) return false;
      if (!q) return true;
      return [row.name, row.ownerName, row.ownerEmail, row.id].some((value) => value.toLowerCase().includes(q));
    });
  }, [query, sourceRows, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="space-y-6">
      <PageHeader title={t("workspaces.title")} description={t("workspaces.description")} />
      <DataSourceBanner />

      {liveQuery.isLoading ? <Skeleton className="h-28 w-full" /> : null}

      {liveQuery.data && !liveQuery.data.isLiveAuthorized ? (
        <UnavailablePanel title={t("unavailable.workspacesTitle")} description={t(liveQuery.data.reasonKey)} />
      ) : null}

      {!showDemoLayoutPreview ? (
        <EmptyState title={t("workspaces.emptyLiveTitle")} description={t("workspaces.emptyLiveBody")} />
      ) : (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--warning)]">
            {t("common.demoPreviewBanner")}
          </p>
          <Card className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1 space-y-1.5 text-sm">
                <span className="font-medium text-[var(--fg)]">{t("workspaces.searchDemo")}</span>
                <Input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                  }}
                  placeholder={t("workspaces.searchPlaceholder")}
                  aria-label={t("workspaces.searchAria")}
                />
              </label>
              <label className="space-y-1.5 text-sm sm:w-48">
                <span className="font-medium text-[var(--fg)]">{t("common.status")}</span>
                <select
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg)]"
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value as "all" | SubscriptionStatus);
                    setPage(0);
                  }}
                  aria-label={t("workspaces.statusFilterAria")}
                >
                  <option value="all">{t("common.allStatuses")}</option>
                  {subscriptionStatuses.map((value) => (
                    <option key={value} value={value}>
                      {t(`status.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Card>

          {pageRows.length === 0 ? (
            <EmptyState title={t("workspaces.emptyDemoTitle")} description={t("workspaces.emptyDemoBody")} />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--bg)_65%,var(--bg-elevated))] text-xs uppercase tracking-wide text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t("workspaces.colCompany")}</th>
                      <th className="px-4 py-3 font-medium">{t("workspaces.colOwner")}</th>
                      <th className="px-4 py-3 font-medium">{t("workspaces.colPlan")}</th>
                      <th className="px-4 py-3 font-medium">{t("workspaces.colStatus")}</th>
                      <th className="px-4 py-3 font-medium">{t("workspaces.colExpires")}</th>
                      <th className="px-4 py-3 font-medium">{t("workspaces.colEmployees")}</th>
                      <th className="px-4 py-3 font-medium">{t("workspaces.colOrders")}</th>
                      <th className="px-4 py-3 font-medium">{t("workspaces.colAccess")}</th>
                      <th className="px-4 py-3 font-medium">{t("workspaces.colActions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row) => (
                      <tr key={row.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-4 py-3">
                          <div className="font-medium text-[var(--fg)]">{row.name}</div>
                          <div className="text-xs text-[var(--muted)]">{row.id}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div>{row.ownerName}</div>
                          <div className="text-xs text-[var(--muted)]">{row.ownerEmail}</div>
                        </td>
                        <td className="px-4 py-3">{t(`plan.${row.planLabel}`)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={row.subscriptionStatus} />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDate(row.subscriptionExpiresAt)}</td>
                        <td className="px-4 py-3">{formatCount(row.employeeCount)}</td>
                        <td className="px-4 py-3">{formatCount(row.orderCount)}</td>
                        <td className="px-4 py-3">{t(`access.${row.accessLabel}`)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Link className="text-[var(--primary)] underline-offset-2 hover:underline" to={`/workspaces/${row.id}`}>
                              {t("common.view")}
                            </Link>
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-auto px-0 py-0 text-[var(--muted)]"
                              disabled
                              title={t("common.manageDisabledTitle")}
                            >
                              {t("common.manage")}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 text-sm">
                <p className="text-[var(--muted)]">
                  {t("workspaces.showing", { shown: pageRows.length, total: filtered.length })}
                </p>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" disabled={currentPage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                    {t("common.previous")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={currentPage >= pageCount - 1}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  >
                    {t("common.next")}
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
