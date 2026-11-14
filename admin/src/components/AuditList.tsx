import { Link } from "react-router-dom";
import { StatusBadge } from "./StatusBadge";
import { normalizeStatus } from "@/data/adminApi";
import type { AuditEntry, SubscriptionSnapshot } from "@/data/types";
import { useT } from "@/i18n/I18nProvider";
import { formatDate, formatDateTime } from "@/lib/format";
import { EmptyState } from "./ui";

function Snapshot({ value }: { value: SubscriptionSnapshot | null }) {
  const t = useT();
  if (!value) return <span className="text-[var(--muted)]">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusBadge status={normalizeStatus(value.subscription_status)} />
      <span className="text-xs text-[var(--muted)]">
        {value.subscription_expires_at ? t("audit.until", { date: formatDate(value.subscription_expires_at) }) : t("audit.noExpiry")}
      </span>
    </span>
  );
}

export function AuditList({ entries, showWorkspace }: { entries: AuditEntry[]; showWorkspace?: boolean }) {
  const t = useT();
  if (entries.length === 0) return <EmptyState title={t("audit.emptyTitle")} description={t("audit.emptyBody")} />;
  return (
    <ul className="divide-y divide-[var(--border)]">
      {entries.map((entry) => (
        <li key={entry.id} className="space-y-1.5 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
            <span>{formatDateTime(entry.createdAt)}</span>
            <span>{entry.actorEmail ?? "—"}</span>
            {showWorkspace && entry.workspaceId ? (
              <Link to={`/workspaces/${entry.workspaceId}`} className="font-medium text-[var(--primary)] hover:underline">
                {entry.workspaceName ?? entry.workspaceId}
              </Link>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Snapshot value={entry.before} />
            <span className="text-[var(--muted)]">→</span>
            <Snapshot value={entry.after} />
          </div>
          {entry.reason ? <p className="text-[var(--fg)]">{entry.reason}</p> : null}
        </li>
      ))}
    </ul>
  );
}
