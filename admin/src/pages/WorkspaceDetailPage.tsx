import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { AccessBadge } from "@/components/AccessBadge";
import { AuditList } from "@/components/AuditList";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorPanel, errorKey } from "@/components/ErrorPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge, Button, Card, Input, PageHeader, Skeleton } from "@/components/ui";
import { accessLabel, extendFrom } from "@/data/subscription";
import { subscriptionStatuses, type AdminWorkspaceDetail, type SubscriptionStatus } from "@/data/types";
import { useAudit, useSetSubscription, useWorkspace } from "@/data/useAdmin";
import { useT } from "@/i18n/I18nProvider";
import { formatCount, formatDate, formatDateTime, fromDateInput, toDateInput } from "@/lib/format";

const selectClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg)]";

export function WorkspaceDetailPage() {
  const t = useT();
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const query = useWorkspace(workspaceId);
  const audit = useAudit(workspaceId);

  return (
    <div className="space-y-6">
      <Link to="/workspaces" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]">
        <ArrowLeft className="size-4" aria-hidden />
        {t("common.backToWorkspaces")}
      </Link>

      {query.isError ? <ErrorPanel error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.isPending ? <Skeleton className="h-64 w-full" /> : null}

      {query.data ? (
        <>
          <PageHeader
            title={query.data.name}
            description={query.data.id}
            actions={
              <div className="flex items-center gap-2">
                {query.data.deletedAt ? <Badge tone="danger">{t("workspaces.deleted")}</Badge> : null}
                <StatusBadge status={query.data.subscriptionStatus} />
                <AccessBadge status={query.data.subscriptionStatus} expiresAt={query.data.subscriptionExpiresAt} />
              </div>
            }
          />

          <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
            <div className="space-y-4">
              <InfoCard workspace={query.data} />
              <MembersCard workspace={query.data} />
              <Card className="px-4 pt-4">
                <h2 className="text-sm font-semibold text-[var(--fg)]">{t("detail.historyTitle")}</h2>
                {audit.isError ? (
                  <div className="py-3">
                    <ErrorPanel error={audit.error} />
                  </div>
                ) : audit.isPending ? (
                  <Skeleton className="my-3 h-20 w-full" />
                ) : (
                  <AuditList entries={audit.data ?? []} />
                )}
              </Card>
            </div>
            <SubscriptionEditor key={query.data.id} workspace={query.data} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-[var(--fg)]">{children}</dd>
    </div>
  );
}

function InfoCard({ workspace }: { workspace: AdminWorkspaceDetail }) {
  const t = useT();
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-[var(--fg)]">{t("detail.infoTitle")}</h2>
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Field label={t("detail.owner")}>
          {workspace.ownerName ?? "—"}
          {workspace.ownerEmail ? <div className="text-xs text-[var(--muted)]">{workspace.ownerEmail}</div> : null}
        </Field>
        <Field label={t("detail.ownerLastSignIn")}>{formatDateTime(workspace.ownerLastSignInAt)}</Field>
        <Field label={t("detail.created")}>{formatDate(workspace.createdAt)}</Field>
        <Field label={t("detail.started")}>{formatDate(workspace.subscriptionStartedAt)}</Field>
        <Field label={t("detail.expires")}>{workspace.subscriptionExpiresAt ? formatDate(workspace.subscriptionExpiresAt) : t("detail.noExpiry")}</Field>
        <Field label={t("detail.languageCurrency")}>
          {(workspace.language ?? "—").toUpperCase()} · {workspace.currency ?? "—"}
        </Field>
        <Field label={t("detail.members")}>{formatCount(workspace.memberCount)}</Field>
        <Field label={t("detail.employees")}>{formatCount(workspace.employeeCount)}</Field>
        <Field label={t("detail.clients")}>{formatCount(workspace.stats.clients)}</Field>
        <Field label={t("detail.orders")}>
          {formatCount(workspace.orderCount)}{" "}
          <span className="text-xs text-[var(--muted)]">({t("workspaces.last30", { count: workspace.ordersLast30d })})</span>
        </Field>
        <Field label={t("detail.estimates")}>{formatCount(workspace.stats.estimates)}</Field>
        <Field label={t("detail.lastOrder")}>{formatDateTime(workspace.lastOrderAt)}</Field>
        {workspace.deletedAt ? <Field label={t("detail.deletedAt")}>{formatDateTime(workspace.deletedAt)}</Field> : null}
      </dl>
    </Card>
  );
}

function MembersCard({ workspace }: { workspace: AdminWorkspaceDetail }) {
  const t = useT();
  return (
    <Card className="overflow-hidden">
      <h2 className="px-4 pt-4 text-sm font-semibold text-[var(--fg)]">{t("detail.membersTitle")}</h2>
      <div className="overflow-x-auto">
        <table className="mt-3 min-w-full text-left text-sm">
          <thead className="border-y border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="px-4 py-2 font-medium">{t("detail.memberName")}</th>
              <th className="px-4 py-2 font-medium">{t("detail.memberRole")}</th>
              <th className="px-4 py-2 font-medium">{t("detail.memberJoined")}</th>
              <th className="px-4 py-2 font-medium">{t("detail.memberLastSignIn")}</th>
            </tr>
          </thead>
          <tbody>
            {workspace.members.map((member) => (
              <tr key={member.userId} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-2.5">
                  <div>{member.name ?? "—"}</div>
                  <div className="text-xs text-[var(--muted)]">{member.email ?? ""}</div>
                </td>
                <td className="px-4 py-2.5">{member.role}</td>
                <td className="whitespace-nowrap px-4 py-2.5">{formatDate(member.joinedAt)}</td>
                <td className="whitespace-nowrap px-4 py-2.5">{formatDateTime(member.lastSignInAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function validate(status: SubscriptionStatus, expiresIso: string | null): string | null {
  if (status === "trial" && !expiresIso) return "detail.validation.trialNeedsDate";
  if ((status === "trial" || status === "active") && expiresIso && new Date(expiresIso).getTime() <= Date.now()) {
    return "detail.validation.dateInPast";
  }
  return null;
}

function SubscriptionEditor({ workspace }: { workspace: AdminWorkspaceDetail }) {
  const t = useT();
  const mutation = useSetSubscription();
  const [status, setStatus] = useState<SubscriptionStatus>(workspace.subscriptionStatus ?? "active");
  const [date, setDate] = useState(toDateInput(workspace.subscriptionExpiresAt));
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 4000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const expiresIso = date ? fromDateInput(date) : null;
  const validationKey = validate(status, expiresIso);
  const unchanged =
    status === workspace.subscriptionStatus && toDateInput(workspace.subscriptionExpiresAt) === date;
  const resultingAccess = accessLabel(status, expiresIso);

  function extend(months: number) {
    if (status !== "active" && status !== "trial") setStatus("active");
    setDate(toDateInput(extendFrom(workspace.subscriptionExpiresAt, months)));
  }

  async function save() {
    try {
      await mutation.mutateAsync({ workspaceId: workspace.id, status, expiresAt: expiresIso, reason });
      setConfirmOpen(false);
      setReason("");
      setSaved(true);
    } catch {
      // error shown in dialog
    }
  }

  return (
    <Card className="h-fit space-y-4 p-4 lg:sticky lg:top-20">
      <div>
        <h2 className="text-sm font-semibold text-[var(--fg)]">{t("detail.subscriptionTitle")}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">{t("detail.subscriptionHint")}</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-[var(--muted)]">{t("detail.quickActions")}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => extend(1)}>
            {t("detail.extend1m")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => extend(3)}>
            {t("detail.extend3m")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => extend(12)}>
            {t("detail.extend12m")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setStatus("active");
              setDate("");
            }}
          >
            {t("detail.unlimited")}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {workspace.subscriptionStatus === "suspended" ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setStatus("active");
                const current = workspace.subscriptionExpiresAt;
                if (current && new Date(current).getTime() <= Date.now()) setDate(toDateInput(extendFrom(null, 1)));
              }}
            >
              {t("detail.reactivate")}
            </Button>
          ) : (
            <Button type="button" variant="danger" onClick={() => setStatus("suspended")}>
              {t("detail.suspend")}
            </Button>
          )}
        </div>
      </div>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-[var(--fg)]">{t("common.status")}</span>
        <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}>
          {subscriptionStatuses.map((value) => (
            <option key={value} value={value}>
              {t(`status.${value}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-[var(--fg)]">{t("detail.expiresInput")}</span>
        <div className="flex gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          {date ? (
            <Button type="button" variant="ghost" onClick={() => setDate("")}>
              {t("detail.clearDate")}
            </Button>
          ) : null}
        </div>
        <span className="block text-xs text-[var(--muted)]">{date ? t("detail.dateInclusive") : t("detail.noExpiry")}</span>
      </label>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-[var(--fg)]">{t("detail.reason")}</span>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("detail.reasonPlaceholder")} maxLength={500} />
      </label>

      <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
        <span className="text-[var(--muted)]">{t("detail.resultingAccess")}</span>
        <Badge tone={resultingAccess === "writable" ? "success" : "danger"}>{t(`access.${resultingAccess}`)}</Badge>
      </div>

      {validationKey ? <p className="text-sm text-[var(--danger)]">{t(validationKey)}</p> : null}
      {saved ? <p className="text-sm text-[var(--success)]">{t("detail.saved")}</p> : null}

      <Button type="button" className="w-full" disabled={unchanged || Boolean(validationKey)} onClick={() => setConfirmOpen(true)}>
        {t("common.save")}
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        title={t("detail.confirmTitle")}
        description={t("detail.confirmBody", { name: workspace.name })}
        confirmVariant={status === "suspended" || status === "cancelled" ? "danger" : "primary"}
        busy={mutation.isPending}
        onClose={() => {
          setConfirmOpen(false);
          mutation.reset();
        }}
        onConfirm={() => void save()}
      >
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-[var(--muted)]">{t("common.status")}</dt>
            <dd className="flex items-center gap-1.5">
              <StatusBadge status={workspace.subscriptionStatus} /> → <StatusBadge status={status} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-[var(--muted)]">{t("detail.expires")}</dt>
            <dd>
              {workspace.subscriptionExpiresAt ? formatDate(workspace.subscriptionExpiresAt) : t("detail.noExpiry")} →{" "}
              {expiresIso ? formatDate(expiresIso) : t("detail.noExpiry")}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-[var(--muted)]">{t("detail.resultingAccess")}</dt>
            <dd>{t(`access.${resultingAccess}`)}</dd>
          </div>
        </dl>
        {mutation.isError ? <p className="mt-3 text-sm text-[var(--danger)]">{t(errorKey(mutation.error))}</p> : null}
      </ConfirmDialog>
    </Card>
  );
}
