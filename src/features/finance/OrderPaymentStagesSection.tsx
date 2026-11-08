import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, FileText, Plus, Trash2, Wallet } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { StatusBadge } from "../../ui/StatusBadge";
import type { Order } from "../../lib/types";
import type { OrderPaymentStage } from "../../services/apiPaymentStages";
import { createInvoiceFromOrder, getInvoices } from "../../services/apiInvoices";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useIndustryProfile } from "../industries/useIndustryProfile";
import { industryPaymentStageTemplate } from "../industries/industryProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useReportFormatting } from "../reports/reportFormatting";
import {
  allocatePaid,
  applyTemplateToStages,
  currentPaymentStage,
  resolveStageAmounts,
  type AllocatedPaymentStage,
  type PaymentStageInput,
  type PaymentStageMode,
  type PaymentStageTemplateItem,
} from "./paymentStages";
import { orderPaymentBalance } from "./paymentCalculations";
import type { LedgerPayment } from "./paymentTypes";
import { PaymentFormDialog } from "./PaymentFormDialog";
import {
  useLinkStageInvoice,
  useOrderPaymentStages,
  useReplaceOrderPaymentStages,
} from "./useOrderPaymentStages";

type OrderPaymentStagesSectionProps = {
  order: Pick<Order, "id" | "totalPrice" | "isPaid" | "status" | "orderNumber" | "createdAt">;
  payments: LedgerPayment[];
  canEdit: boolean;
  onBeforeRecord?: () => Promise<boolean>;
};

function stageToInput(stage: OrderPaymentStage): PaymentStageInput {
  return {
    id: stage.id,
    position: stage.position,
    name: stage.name,
    mode: stage.mode,
    percent: stage.percent,
    amount: stage.amount,
    dueDate: stage.dueDate,
    invoiceId: stage.invoiceId,
  };
}

function stateVariant(state: AllocatedPaymentStage["state"]): "success" | "warning" | "danger" | "default" {
  if (state === "paid") return "success";
  if (state === "partial") return "warning";
  if (state === "overdue") return "danger";
  return "default";
}

function emptyDraft(position: number): PaymentStageInput {
  return {
    position,
    name: "",
    mode: "percent",
    percent: 10,
    amount: null,
    dueDate: null,
    invoiceId: null,
  };
}

/**
 * «График оплат» under payment history.
 * Orders without stages keep today’s single-payment behaviour (section still offers Apply template).
 */
export function OrderPaymentStagesSection({
  order,
  payments,
  canEdit,
  onBeforeRecord,
}: OrderPaymentStagesSectionProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const { formatDate } = useReportFormatting();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const { profile } = useIndustryProfile();
  const { stages, isLoading } = useOrderPaymentStages(order.id);
  const replaceStages = useReplaceOrderPaymentStages(order.id);
  const linkInvoice = useLinkStageInvoice();

  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState<PaymentStageInput[]>([]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentPrefill, setPaymentPrefill] = useState<number | null>(null);
  const [busyInvoiceId, setBusyInvoiceId] = useState<string | null>(null);

  const balance = useMemo(() => orderPaymentBalance(order, payments), [order, payments]);
  const allocated = useMemo(
    () => allocatePaid(stages.map(stageToInput), order.totalPrice, balance.netPaid),
    [stages, order.totalPrice, balance.netPaid],
  );
  const current = currentPaymentStage(allocated);
  const { warning: liveWarning } = useMemo(
    () => resolveStageAmounts(draftOpen ? draft : stages.map(stageToInput), order.totalPrice),
    [draftOpen, draft, stages, order.totalPrice],
  );

  const resolvedTemplate = useMemo((): PaymentStageTemplateItem[] => {
    if (workspace?.paymentStageTemplate && workspace.paymentStageTemplate.length > 0) {
      return workspace.paymentStageTemplate;
    }
    return industryPaymentStageTemplate(profile);
  }, [workspace?.paymentStageTemplate, profile]);

  function startEdit(from: PaymentStageInput[] = stages.map(stageToInput)) {
    setDraft(from.length > 0 ? from.map((row, i) => ({ ...row, position: i })) : [emptyDraft(0)]);
    setDraftOpen(true);
  }

  async function applyTemplate() {
    if (!canEdit || replaceStages.isPending) return;
    const next = applyTemplateToStages(resolvedTemplate, {
      fromDate: order.createdAt ? new Date(order.createdAt) : new Date(),
    });
    try {
      await replaceStages.mutateAsync(
        next.map((row) => ({
          name: row.name,
          mode: row.mode,
          percent: row.percent,
          amount: row.amount,
          dueDate: row.dueDate,
          position: row.position,
        })),
      );
      toast.success(t("finance.paymentStages.toast.templateApplied"));
      setDraftOpen(false);
    } catch {
      // hook toasts
    }
  }

  async function saveDraft() {
    if (!canEdit || replaceStages.isPending) return;
    const cleaned = draft
      .map((row, index) => ({ ...row, position: index, name: row.name.trim() }))
      .filter((row) => row.name.length > 0);
    if (cleaned.length === 0) {
      toast.error(t("finance.paymentStages.errors.nameRequired"));
      return;
    }
    try {
      await replaceStages.mutateAsync(
        cleaned.map((row) => ({
          name: row.name,
          mode: row.mode,
          percent: row.percent,
          amount: row.amount,
          dueDate: row.dueDate,
          position: row.position,
          invoiceId: row.invoiceId ?? null,
        })),
      );
      toast.success(t("finance.paymentStages.toast.saved"));
      setDraftOpen(false);
    } catch {
      // hook toasts
    }
  }

  async function openRecordPayment(amount?: number) {
    if (onBeforeRecord) {
      if (!(await onBeforeRecord())) return;
    }
    setPaymentPrefill(amount ?? current?.remaining ?? balance.remaining);
    setPaymentOpen(true);
  }

  async function createStageInvoice(stage: AllocatedPaymentStage) {
    if (!canEdit || !stage.id || busyInvoiceId) return;
    setBusyInvoiceId(stage.id);
    try {
      let invoiceId = stage.invoiceId;
      if (!invoiceId) {
        const existing = (await getInvoices(workspaceId)).find((inv) => inv.orderId === order.id);
        if (existing) {
          invoiceId = existing.id;
        } else {
          const created = await createInvoiceFromOrder(order.id, workspaceId);
          invoiceId = created.id;
        }
        await linkInvoice.mutateAsync({ stageId: stage.id, invoiceId });
      }
      toast.success(t("finance.paymentStages.toast.invoiceLinked", { number: stage.name }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.paymentStages.errors.saveFailed"));
    } finally {
      setBusyInvoiceId(null);
    }
  }

  function moveDraft(index: number, delta: number) {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= draft.length) return;
    const next = draft.slice();
    const [row] = next.splice(index, 1);
    next.splice(nextIndex, 0, row!);
    setDraft(next.map((item, i) => ({ ...item, position: i })));
  }

  const recordableBalance = balance.isLegacyUnreconciled
    ? { ...balance, remaining: paymentPrefill ?? balance.total, netPaid: 0, status: "unpaid" as const }
    : paymentPrefill != null && paymentPrefill > 0
      ? { ...balance, remaining: paymentPrefill }
      : balance;

  const showEmptyHint = !isLoading && stages.length === 0 && !draftOpen;

  return (
    <div className="space-y-3 border-t border-border pt-5" data-testid="order-payment-stages">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t("finance.paymentStages.title")}</h3>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={replaceStages.isPending} onClick={() => void applyTemplate()}>
              {t("finance.paymentStages.applyTemplate")}
            </Button>
            {!draftOpen ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => startEdit(stages.length ? stages.map(stageToInput) : [emptyDraft(0)])}
              >
                <Plus className="size-4" />
                {stages.length ? t("finance.paymentStages.edit") : t("finance.paymentStages.addStage")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {showEmptyHint ? (
        <p className="text-sm text-muted-foreground">{t("finance.paymentStages.emptyHint")}</p>
      ) : null}

      {liveWarning === "over_total" ? (
        <p className="text-sm text-destructive" role="status">
          {t("finance.paymentStages.warningOverTotal")}
        </p>
      ) : null}
      {liveWarning === "sum_mismatch" ? (
        <p className="text-sm text-amber-700 dark:text-amber-400" role="status">
          {t("finance.paymentStages.warningSumMismatch")}
        </p>
      ) : null}

      {draftOpen ? (
        <div className="space-y-3">
          {draft.map((row, index) => (
            <div
              key={row.id ?? `draft-${index}`}
              className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <div className="space-y-1">
                <Label>{t("finance.paymentStages.columns.name")}</Label>
                <Input
                  value={row.name}
                  onChange={(e) =>
                    setDraft((prev) => prev.map((item, i) => (i === index ? { ...item, name: e.target.value } : item)))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>{t("finance.paymentStages.columns.mode")}</Label>
                <Select
                  value={row.mode}
                  onValueChange={(mode: PaymentStageMode) =>
                    setDraft((prev) =>
                      prev.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              mode,
                              percent: mode === "percent" ? item.percent ?? 10 : null,
                              amount: mode === "amount" ? item.amount ?? 0 : null,
                            }
                          : item,
                      ),
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">{t("finance.paymentStages.modes.percent")}</SelectItem>
                    <SelectItem value="amount">{t("finance.paymentStages.modes.amount")}</SelectItem>
                    <SelectItem value="remainder">{t("finance.paymentStages.modes.remainder")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>
                  {row.mode === "amount"
                    ? t("finance.paymentStages.columns.amount")
                    : row.mode === "percent"
                      ? t("finance.paymentStages.columns.percent")
                      : t("finance.paymentStages.modes.remainder")}
                </Label>
                {row.mode === "remainder" ? (
                  <Input disabled value="—" />
                ) : (
                  <Input
                    type="number"
                    step="0.01"
                    value={row.mode === "percent" ? (row.percent ?? "") : (row.amount ?? "")}
                    onChange={(e) => {
                      const n = e.target.value === "" ? null : Number(e.target.value);
                      setDraft((prev) =>
                        prev.map((item, i) =>
                          i === index
                            ? row.mode === "percent"
                              ? { ...item, percent: n }
                              : { ...item, amount: n }
                            : item,
                        ),
                      );
                    }}
                  />
                )}
              </div>
              <div className="space-y-1">
                <Label>{t("finance.paymentStages.columns.dueDate")}</Label>
                <Input
                  type="date"
                  value={row.dueDate ?? ""}
                  onChange={(e) =>
                    setDraft((prev) =>
                      prev.map((item, i) => (i === index ? { ...item, dueDate: e.target.value || null } : item)),
                    )
                  }
                />
              </div>
              <div className="flex items-end gap-1">
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => moveDraft(index, -1)} disabled={index === 0}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => moveDraft(index, 1)}
                  disabled={index === draft.length - 1}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index).map((item, i) => ({ ...item, position: i })))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setDraft((prev) => [...prev, emptyDraft(prev.length)])}>
              <Plus className="size-4" />
              {t("finance.paymentStages.addStage")}
            </Button>
            <Button type="button" size="sm" onClick={() => void saveDraft()} disabled={replaceStages.isPending}>
              {t("common.save")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraftOpen(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {!draftOpen && allocated.length > 0 ? (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border border-border sm:block">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("finance.paymentStages.columns.name")}</th>
                  <th className="px-3 py-2 font-medium">{t("finance.paymentStages.columns.plan")}</th>
                  <th className="px-3 py-2 font-medium">{t("finance.paymentStages.columns.dueDate")}</th>
                  <th className="px-3 py-2 font-medium">{t("finance.paymentStages.columns.due")}</th>
                  <th className="px-3 py-2 font-medium">{t("finance.paymentStages.columns.paid")}</th>
                  <th className="px-3 py-2 font-medium">{t("finance.paymentStages.columns.state")}</th>
                  <th className="px-3 py-2 font-medium">{t("finance.paymentStages.columns.invoice")}</th>
                  {canEdit ? <th className="px-3 py-2 font-medium" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {allocated.map((stage) => (
                  <tr key={stage.id ?? stage.position} className="align-top">
                    <td className="px-3 py-2 font-medium text-foreground">{stage.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {stage.mode === "percent"
                        ? `${stage.percent ?? 0}%`
                        : stage.mode === "amount"
                          ? formatMoney(stage.amount ?? 0)
                          : t("finance.paymentStages.modes.remainder")}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {stage.dueDate ? formatDate(stage.dueDate) : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(stage.due)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(stage.paid)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge variant={stateVariant(stage.state)}>
                        {t(`finance.paymentStages.states.${stage.state}`)}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2">
                      {stage.invoiceId ? (
                        <Link className="text-primary underline-offset-2 hover:underline" to={`/invoices?invoice=${stage.invoiceId}`}>
                          {t("finance.paymentStages.viewInvoice")}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    {canEdit ? (
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap justify-end gap-1">
                          {stage.state !== "paid" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busyInvoiceId === stage.id}
                              onClick={() => void createStageInvoice(stage)}
                            >
                              <FileText className="size-3.5" />
                              {t("finance.paymentStages.invoiceForStage")}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-2 sm:hidden">
            {allocated.map((stage) => (
              <li key={stage.id ?? stage.position} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">{stage.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {stage.mode === "percent"
                        ? `${stage.percent ?? 0}%`
                        : stage.mode === "amount"
                          ? formatMoney(stage.amount ?? 0)
                          : t("finance.paymentStages.modes.remainder")}
                      {stage.dueDate ? ` · ${formatDate(stage.dueDate)}` : ""}
                    </p>
                  </div>
                  <StatusBadge variant={stateVariant(stage.state)}>
                    {t(`finance.paymentStages.states.${stage.state}`)}
                  </StatusBadge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">{t("finance.paymentStages.columns.due")}</p>
                    <p className="tabular-nums">{formatMoney(stage.due)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("finance.paymentStages.columns.paid")}</p>
                    <p className="tabular-nums">{formatMoney(stage.paid)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("finance.paymentStages.columns.remaining")}</p>
                    <p className="tabular-nums">{formatMoney(stage.remaining)}</p>
                  </div>
                </div>
                {canEdit && stage.state !== "paid" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 w-full"
                    disabled={busyInvoiceId === stage.id}
                    onClick={() => void createStageInvoice(stage)}
                  >
                    {t("finance.paymentStages.invoiceForStage")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>

          {canEdit && current && current.remaining > 0 ? (
            <Button type="button" size="sm" onClick={() => void openRecordPayment(current.remaining)}>
              <Wallet className="size-4" />
              {t("finance.paymentStages.recordPayment")}
            </Button>
          ) : null}
        </>
      ) : null}

      {isLoading ? <p className="text-sm text-muted-foreground">{t("common.loadingEllipsis")}</p> : null}

      <PaymentFormDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        target="order"
        orderId={order.id}
        balance={recordableBalance}
        currentStageLabel={
          current
            ? t("finance.paymentStages.currentlyPaying", {
                name: current.name,
                amount: formatMoney(current.remaining),
              })
            : null
        }
      />
    </div>
  );
}
