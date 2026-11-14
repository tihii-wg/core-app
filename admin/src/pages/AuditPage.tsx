import { AuditList } from "@/components/AuditList";
import { ErrorPanel } from "@/components/ErrorPanel";
import { Card, PageHeader, Skeleton } from "@/components/ui";
import { useAudit } from "@/data/useAdmin";
import { useT } from "@/i18n/I18nProvider";

export function AuditPage() {
  const t = useT();
  const query = useAudit();
  return (
    <div className="space-y-6">
      <PageHeader title={t("audit.title")} description={t("audit.description")} />
      {query.isError ? <ErrorPanel error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : query.data ? (
        <Card className="px-4">
          <AuditList entries={query.data} showWorkspace />
        </Card>
      ) : null}
    </div>
  );
}
