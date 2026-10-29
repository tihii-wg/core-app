import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataSourceBanner } from "@/components/DataSourceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { UnavailablePanel } from "@/components/UnavailablePanel";
import { Button, Card, EmptyState, Input, PageHeader } from "@/components/ui";
import { adminCapabilities } from "@/data/capabilities";
import { getDemoWorkspace } from "@/data/demoWorkspaces";
import { demoPlanLabels } from "@/data/types";
import { runAdminMutation, type AdminMutationKind } from "@/data/workspaceAdminApi";
import { useT } from "@/i18n/I18nProvider";
import { formatCount, formatDate } from "@/lib/format";
import { useLayoutPreview } from "@/state/LayoutPreviewContext";

export function WorkspaceDetailPage() {
  const t = useT();
  const { workspaceId = "" } = useParams();
  const { showDemoLayoutPreview } = useLayoutPreview();
  const workspace = useMemo(() => getDemoWorkspace(workspaceId), [workspaceId]);
  const [dialog, setDialog] = useState<"plan" | "expiration" | "suspend" | "reactivate" | null>(null);
  const [proposedPlan, setProposedPlan] = useState<(typeof demoPlanLabels)[number]>("professional");
  const [proposedExpiry, setProposedExpiry] = useState("");
  const [mutationMessage, setMutationMessage] = useState<string | null>(null);

  const blockedReason = t("detail.blockedReason");

  async function attemptMutation(kind: AdminMutationKind) {
    setMutationMessage(null);
    const result = await runAdminMutation(kind, workspaceId);
    if (!result.ok) {
      setMutationMessage(t(result.messageKey));
      return;
    }
    setMutationMessage(t("detail.unexpectedSuccess"));
  }

  if (!showDemoLayoutPreview) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t("detail.titleLive")}
          description={t("detail.descriptionLive")}
          actions={
            <Link className="text-sm text-[var(--primary)] underline-offset-2 hover:underline" to="/workspaces">
              {t("common.backToWorkspaces")}
            </Link>
          }
        />
        <DataSourceBanner />
        <UnavailablePanel title={t("unavailable.detailTitle")} description={t("liveData.unavailableReason")} />
        <EmptyState title={t("detail.emptyLiveTitle")} description={t("detail.emptyLiveBody")} />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("detail.notFoundTitle")} description={t("detail.notFoundDescription")} />
        <DataSourceBanner />
        <EmptyState title={t("detail.emptyUnknownTitle")} description={t("detail.emptyUnknownBody")} />
        <Link className="text-sm text-[var(--primary)] underline-offset-2 hover:underline" to="/workspaces">
          {t("common.backToWorkspaces")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={workspace.name}
        description={t("detail.demoTitleSuffix")}
        actions={
          <Link className="text-sm text-[var(--primary)] underline-offset-2 hover:underline" to="/workspaces">
            {t("common.backToWorkspaces")}
          </Link>
        }
      />
      <DataSourceBanner />
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--warning)]">{t("common.demoPreviewBanner")}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-5">
          <h2 className="text-sm font-semibold text-[var(--fg)]">{t("detail.sectionWorkspace")}</h2>
          <Detail label={t("detail.workspaceId")} value={workspace.id} />
          <Detail label={t("detail.companyName")} value={workspace.name} />
          <Detail label={t("detail.ownerName")} value={workspace.ownerName} />
          <Detail label={t("detail.ownerEmail")} value={workspace.ownerEmail} />
          <Detail label={t("detail.accessLabel")} value={t(`access.${workspace.accessLabel}`)} />
        </Card>
        <Card className="space-y-3 p-5">
          <h2 className="text-sm font-semibold text-[var(--fg)]">{t("detail.sectionSubscription")}</h2>
          <Detail label={t("detail.planLabel")} value={t(`plan.${workspace.planLabel}`)} />
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-[var(--muted)]">{t("common.status")}</span>
            <StatusBadge status={workspace.subscriptionStatus} />
          </div>
          <Detail label={t("detail.started")} value={formatDate(workspace.subscriptionStartedAt)} />
          <Detail label={t("detail.expires")} value={formatDate(workspace.subscriptionExpiresAt)} />
          <Detail label={t("detail.employees")} value={formatCount(workspace.employeeCount)} />
          <Detail label={t("detail.orders")} value={formatCount(workspace.orderCount)} />
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-[var(--fg)]">{t("detail.actionsTitle")}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("detail.actionsBody")}</p>
        {mutationMessage ? <p className="mt-3 text-sm text-[var(--danger)]">{mutationMessage}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={!adminCapabilities.changePlan} title={blockedReason}>
            {t("detail.changePlan")}
          </Button>
          <Button type="button" variant="secondary" disabled={!adminCapabilities.changeExpiration} title={blockedReason}>
            {t("detail.changeExpiration")}
          </Button>
          <Button type="button" variant="danger" disabled={!adminCapabilities.suspendWorkspace} title={blockedReason}>
            {t("detail.suspend")}
          </Button>
          <Button type="button" variant="secondary" disabled={!adminCapabilities.reactivateWorkspace} title={blockedReason}>
            {t("detail.reactivate")}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setProposedPlan(workspace.planLabel === "unknown" ? "professional" : workspace.planLabel);
              setDialog("plan");
            }}
          >
            {t("detail.previewPlan")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setProposedExpiry(workspace.subscriptionExpiresAt?.slice(0, 10) ?? "");
              setDialog("expiration");
            }}
          >
            {t("detail.previewExpiration")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setDialog("suspend")}>
            {t("detail.previewSuspend")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setDialog("reactivate")}>
            {t("detail.previewReactivate")}
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={dialog === "plan"}
        title={t("detail.planDialogTitle")}
        description={t("detail.planDialogBody", { plan: t(`plan.${workspace.planLabel}`) })}
        confirmLabel={t("detail.planDialogConfirm")}
        confirmDisabled
        disabledReason={blockedReason}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          void attemptMutation("changePlan");
          setDialog(null);
        }}
      >
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">{t("detail.proposedPlan")}</span>
          <select
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)]"
            value={proposedPlan}
            onChange={(event) => setProposedPlan(event.target.value as typeof proposedPlan)}
          >
            {demoPlanLabels.map((plan) => (
              <option key={plan} value={plan}>
                {t(`plan.${plan}`)}
              </option>
            ))}
          </select>
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "expiration"}
        title={t("detail.expirationDialogTitle")}
        description={t("detail.expirationDialogBody", { date: formatDate(workspace.subscriptionExpiresAt) })}
        confirmLabel={t("detail.expirationDialogConfirm")}
        confirmDisabled
        disabledReason={blockedReason}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          void attemptMutation("changeExpiration");
          setDialog(null);
        }}
      >
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">{t("detail.proposedExpiry")}</span>
          <Input type="date" value={proposedExpiry} onChange={(event) => setProposedExpiry(event.target.value)} />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "suspend"}
        title={t("detail.suspendDialogTitle")}
        description={t("detail.suspendDialogBody")}
        confirmLabel={t("detail.suspendDialogConfirm")}
        confirmDisabled
        disabledReason={blockedReason}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          void attemptMutation("suspend");
          setDialog(null);
        }}
      />

      <ConfirmDialog
        open={dialog === "reactivate"}
        title={t("detail.reactivateDialogTitle")}
        description={t("detail.reactivateDialogBody")}
        confirmLabel={t("detail.reactivateDialogConfirm")}
        confirmDisabled
        disabledReason={blockedReason}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          void attemptMutation("reactivate");
          setDialog(null);
        }}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="max-w-[60%] break-all text-right font-medium text-[var(--fg)]">{value}</span>
    </div>
  );
}
