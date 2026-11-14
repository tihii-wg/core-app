import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { AccessBadge } from "@/components/AccessBadge";
import { ErrorPanel } from "@/components/ErrorPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Skeleton } from "@/components/ui";
import { accessLabel } from "@/data/subscription";
import { subscriptionStatuses, type AdminWorkspace, type SubscriptionStatus } from "@/data/types";
import { useWorkspaces } from "@/data/useAdmin";
import { useT } from "@/i18n/I18nProvider";
import { formatCount, formatDate } from "@/lib/format";

const PAGE_SIZE = 25;
type SortKey = "created" | "expires" | "orders" | "name";
type StatusFilter = "all" | SubscriptionStatus | "unknown";

const selectClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg)]";

function sortRows(rows: AdminWorkspace[], key: SortKey) {
  const copy = [...rows];
  if (key === "name") return copy.sort((a, b) => a.name.localeCompare(b.name));
  if (key === "orders") return copy.sort((a, b) => b.orderCount - a.orderCount);
  if (key === "expires") {
    return copy.sort((a, b) => {
      if (!a.subscriptionExpiresAt) return 1;
      if (!b.subscriptionExpiresAt) return -1;
      return a.subscriptionExpiresAt.localeCompare(b.subscriptionExpiresAt);
    });
  }
  return copy.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export function WorkspacesPage() {
  const t = useT();
  const query = useWorkspaces();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [access, setAccess] = useState<"all" | "writable" | "read-only">("all");
  const [sort, setSort] = useState<SortKey>("created");
  const [showDeleted, setShowDeleted] = useState(false);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = (query.data ?? []).filter((row) => {
      if (!showDeleted && row.deletedAt) return false;
      if (status === "unknown" ? row.subscriptionStatus != null : status !== "all" && row.subscriptionStatus !== status) return false;
      if (access !== "all" && accessLabel(row.subscriptionStatus, row.subscriptionExpiresAt) !== access) return false;
      if (!q) return true;
      return [row.name, row.ownerName, row.ownerEmail, row.id].some((v) => v?.toLowerCase().includes(q));
    });
    return sortRows(rows, sort);
  }, [access, query.data, search, showDeleted, sort, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const reset = () => setPage(0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("workspaces.title")}
        description={t("workspaces.description")}
        actions={
          <Button type="button" variant="secondary" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={query.isFetching ? "size-4 animate-spin" : "size-4"} aria-hidden />
            {t("common.refresh")}
          </Button>
        }
      />

      {query.isError ? <ErrorPanel error={query.error} onRetry={() => void query.refetch()} /> : null}

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_11rem_11rem_11rem]">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-[var(--fg)]">{t("common.search")}</span>
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                reset();
              }}
              placeholder={t("workspaces.searchPlaceholder")}
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-[var(--fg)]">{t("common.status")}</span>
            <select
              className={selectClass}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as StatusFilter);
                reset();
              }}
            >
              <option value="all">{t("common.allStatuses")}</option>
              {subscriptionStatuses.map((value) => (
                <option key={value} value={value}>
                  {t(`status.${value}`)}
                </option>
              ))}
              <option value="unknown">{t("common.unknown")}</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-[var(--fg)]">{t("workspaces.colAccess")}</span>
            <select
              className={selectClass}
              value={access}
              onChange={(e) => {
                setAccess(e.target.value as typeof access);
                reset();
              }}
            >
              <option value="all">{t("common.all")}</option>
              <option value="writable">{t("access.writable")}</option>
              <option value="read-only">{t("access.read-only")}</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-[var(--fg)]">{t("workspaces.sort")}</span>
            <select className={selectClass} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="created">{t("workspaces.sortCreated")}</option>
              <option value="expires">{t("workspaces.sortExpires")}</option>
              <option value="orders">{t("workspaces.sortOrders")}</option>
              <option value="name">{t("workspaces.sortName")}</option>
            </select>
          </label>
        </div>
        <label className="mt-3 inline-flex items-center gap-2 text-sm text-[var(--muted)]">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(e) => {
              setShowDeleted(e.target.checked);
              reset();
            }}
          />
          {t("workspaces.showDeleted")}
        </label>
      </Card>

      {query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : query.data && pageRows.length === 0 ? (
        <EmptyState title={t("workspaces.emptyTitle")} description={t("workspaces.emptyBody")} />
      ) : query.data ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--bg)_65%,var(--bg-elevated))] text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("workspaces.colCompany")}</th>
                  <th className="px-4 py-3 font-medium">{t("workspaces.colOwner")}</th>
                  <th className="px-4 py-3 font-medium">{t("workspaces.colStatus")}</th>
                  <th className="px-4 py-3 font-medium">{t("workspaces.colExpires")}</th>
                  <th className="px-4 py-3 font-medium">{t("workspaces.colAccess")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("workspaces.colMembers")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("workspaces.colOrders")}</th>
                  <th className="px-4 py-3 font-medium">{t("workspaces.colCreated")}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[color-mix(in_oklab,var(--bg)_50%,transparent)]">
                    <td className="px-4 py-3">
                      <Link className="font-medium text-[var(--primary)] hover:underline" to={`/workspaces/${row.id}`}>
                        {row.name}
                      </Link>
                      {row.deletedAt ? (
                        <span className="ml-2">
                          <Badge tone="danger">{t("workspaces.deleted")}</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div>{row.ownerName ?? "—"}</div>
                      <div className="text-xs text-[var(--muted)]">{row.ownerEmail ?? ""}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.subscriptionStatus} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{formatDate(row.subscriptionExpiresAt)}</td>
                    <td className="px-4 py-3">
                      <AccessBadge status={row.subscriptionStatus} expiresAt={row.subscriptionExpiresAt} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCount(row.memberCount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCount(row.orderCount)}
                      <div className="text-xs text-[var(--muted)]">{t("workspaces.last30", { count: row.ordersLast30d })}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{formatDate(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 text-sm">
            <p className="text-[var(--muted)]">{t("workspaces.showing", { shown: pageRows.length, total: filtered.length })}</p>
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
      ) : null}
    </div>
  );
}
