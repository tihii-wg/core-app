import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ErrorPanel } from "@/components/ErrorPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { accessLabel, daysUntil } from "@/data/subscription";
import { subscriptionStatuses } from "@/data/types";
import { useWorkspaces } from "@/data/useAdmin";
import { useT } from "@/i18n/I18nProvider";
import { formatCount, formatDate } from "@/lib/format";

const EXPIRING_DAYS = 14;

export function OverviewPage() {
  const t = useT();
  const query = useWorkspaces();

  const summary = useMemo(() => {
    const rows = (query.data ?? []).filter((row) => !row.deletedAt);
    const now = Date.now();
    const byStatus = Object.fromEntries(subscriptionStatuses.map((s) => [s, 0])) as Record<string, number>;
    let unknown = 0;
    let writable = 0;
    let newLast30 = 0;
    let orders30 = 0;
    for (const row of rows) {
      if (row.subscriptionStatus) byStatus[row.subscriptionStatus] += 1;
      else unknown += 1;
      if (accessLabel(row.subscriptionStatus, row.subscriptionExpiresAt) === "writable") writable += 1;
      if (row.createdAt && now - new Date(row.createdAt).getTime() <= 30 * 86_400_000) newLast30 += 1;
      orders30 += row.ordersLast30d;
    }
    const expiring = rows
      .filter((row) => {
        const days = daysUntil(row.subscriptionExpiresAt);
        return days != null && days >= 0 && days <= EXPIRING_DAYS && (row.subscriptionStatus === "active" || row.subscriptionStatus === "trial");
      })
      .sort((a, b) => (a.subscriptionExpiresAt ?? "").localeCompare(b.subscriptionExpiresAt ?? ""));
    return { total: rows.length, byStatus, unknown, writable, newLast30, orders30, expiring };
  }, [query.data]);

  return (
    <div className="space-y-6">
      <PageHeader title={t("overview.title")} description={t("overview.description")} />

      {query.isError ? <ErrorPanel error={query.error} onRetry={() => void query.refetch()} /> : null}

      {query.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : query.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label={t("overview.total")} value={summary.total} />
            <Metric label={t("overview.writable")} value={summary.writable} />
            <Metric label={t("overview.newLast30")} value={summary.newLast30} />
            <Metric label={t("overview.orders30")} value={summary.orders30} />
          </div>

          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--fg)]">{t("overview.byStatus")}</h2>
            <div className="flex flex-wrap gap-3">
              {subscriptionStatuses.map((status) => (
                <div key={status} className="flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2">
                  <StatusBadge status={status} />
                  <span className="text-sm font-semibold tabular-nums">{formatCount(summary.byStatus[status])}</span>
                </div>
              ))}
              {summary.unknown ? (
                <div className="flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2">
                  <StatusBadge status={null} />
                  <span className="text-sm font-semibold tabular-nums">{formatCount(summary.unknown)}</span>
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--fg)]">
              {t("overview.expiringTitle", { days: EXPIRING_DAYS })}
            </h2>
            {summary.expiring.length === 0 ? (
              <EmptyState title={t("overview.expiringEmpty")} description={t("overview.expiringEmptyBody")} />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {summary.expiring.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <Link to={`/workspaces/${row.id}`} className="min-w-0 font-medium text-[var(--primary)] hover:underline">
                      {row.name}
                    </Link>
                    <div className="flex items-center gap-3 text-sm">
                      <StatusBadge status={row.subscriptionStatus} />
                      <span className="text-[var(--muted)]">
                        {formatDate(row.subscriptionExpiresAt)} · {t("overview.inDays", { days: daysUntil(row.subscriptionExpiresAt) ?? 0 })}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--fg)]">{formatCount(value)}</p>
    </Card>
  );
}
