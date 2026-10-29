import { useQuery } from "@tanstack/react-query";
import { DataSourceBanner } from "@/components/DataSourceBanner";
import { UnavailablePanel } from "@/components/UnavailablePanel";
import { Card, PageHeader, Skeleton } from "@/components/ui";
import { DEMO_WORKSPACES, summarizeDemoWorkspaces } from "@/data/demoWorkspaces";
import { fetchAdminWorkspacesLive } from "@/data/workspaceAdminApi";
import { useT } from "@/i18n/I18nProvider";
import { formatCount } from "@/lib/format";
import { useLayoutPreview } from "@/state/LayoutPreviewContext";

export function OverviewPage() {
  const t = useT();
  const { showDemoLayoutPreview } = useLayoutPreview();
  const liveQuery = useQuery({
    queryKey: ["admin", "workspaces", "live"],
    queryFn: fetchAdminWorkspacesLive,
  });

  const demoSummary = summarizeDemoWorkspaces(DEMO_WORKSPACES);

  return (
    <div className="space-y-6">
      <PageHeader title={t("overview.title")} description={t("overview.description")} />
      <DataSourceBanner />

      {liveQuery.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : null}

      {liveQuery.data && !liveQuery.data.isLiveAuthorized ? (
        <UnavailablePanel title={t("unavailable.metricsTitle")} description={t(liveQuery.data.reasonKey)} />
      ) : null}

      {showDemoLayoutPreview ? (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--warning)]">
            {t("common.demoPreviewBanner")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label={t("overview.totalWorkspacesDemo")} value={formatCount(demoSummary.totalWorkspaces)} />
            <Metric label={t("overview.activeSubsDemo")} value={formatCount(demoSummary.activeSubscriptions)} />
            <Metric label={t("overview.expiredSubsDemo")} value={formatCount(demoSummary.expiredSubscriptions)} />
            <Metric label={t("overview.suspendedDemo")} value={formatCount(demoSummary.suspendedWorkspaces)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-[var(--fg)]">{t("overview.statusDistribution")}</h2>
              <ul className="mt-4 space-y-2">
                {Object.entries(demoSummary.byStatus).map(([status, count]) => (
                  <li key={status} className="flex items-center justify-between text-sm">
                    <span className="text-[var(--muted)]">{t(`status.${status}`)}</span>
                    <span className="font-medium text-[var(--fg)]">{formatCount(count)}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-[var(--fg)]">{t("overview.planDistribution")}</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">{t("overview.planHint")}</p>
              <ul className="mt-4 space-y-2">
                {Object.entries(demoSummary.byPlan).map(([plan, count]) => (
                  <li key={plan} className="flex items-center justify-between text-sm">
                    <span className="text-[var(--muted)]">{t(`plan.${plan}`)}</span>
                    <span className="font-medium text-[var(--fg)]">{formatCount(count)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-[var(--fg)]">{value}</p>
    </Card>
  );
}
