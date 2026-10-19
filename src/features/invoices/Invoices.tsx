import { useState, useMemo } from "react";
import { Plus, AlertCircle, FileText, FileX2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { EmptyState, ErrorState } from "../../ui/EmptyState";
import { InvoiceStatusBadge } from "../../ui/StatusBadge";
import type { Invoice, InvoiceStatus } from "../../lib/types";
import { Button } from "../../ui/Button";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useGetOrders } from "../orders/useGetOrders";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useGetInvoices } from "./useGetInvoices";
import { useUpdateInvoiceStatus } from "./useUpdateInvoiceStatus";
import { CreateInvoiceDialog } from "./CreateInvoiceDialog";
import { InvoiceActionsMenu } from "./InvoiceActionsMenu";
import { InvoiceDetailPanel } from "./InvoiceDetailPanel";

export function Invoices() {
  const { t } = useTranslation();
  const { workflow, copy } = useIndustryWorkflow();
  const { invoices, isLoading, error, refetch, isUnavailable } = useGetInvoices();
  const { orders } = useGetOrders("", { enabled: !isUnavailable });
  const updateStatus = useUpdateInvoiceStatus();
  const { currency, formatMoney } = useWorkspaceMoney();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);

  const overdueCount = invoices.filter((i) => i.status === "overdue").length;
  const unpaidTotal = invoices.filter((i) => i.status === "sent" || i.status === "overdue").reduce((sum, i) => sum + i.amount, 0);

  const invoiceableOrders = useMemo(() => {
    const invoicedOrderIds = new Set(invoices.map((invoice) => invoice.orderId));
    return orders.filter((order) => order.status !== "cancelled" && order.services.length > 0 && !invoicedOrderIds.has(order.id));
  }, [invoices, orders]);

  const filteredInvoices = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return invoices.filter((invoice) => {
      const matchesSearch = !query || invoice.invoiceNumber.toLowerCase().includes(query) || invoice.clientName.toLowerCase().includes(query) || (invoice.orderNumber ?? "").toLowerCase().includes(query);
      const matchesStatus = statusFilter === "all" || invoice.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [invoices, searchQuery, statusFilter]);

  const handleStatusChange = (invoice: Invoice, status: InvoiceStatus) => {
    if (updateStatus.isPending) return;
    updateStatus.mutate({ invoiceId: invoice.id, status });
  };

  const columns: Column<Invoice>[] = [
    {
      key: "invoiceNumber",
      header: t("invoices.columns.number"),
      cell: (invoice) => <span className="font-medium text-primary tabular-nums">{invoice.invoiceNumber}</span>,
      className: "whitespace-nowrap",
    },
    {
      key: "client",
      header: t("invoices.columns.client"),
      cell: (invoice) => {
        const phone = invoice.clientPhone?.trim() || "—";
        return (
          <div className="max-w-[11rem] min-w-0">
            <div className="truncate font-medium" title={invoice.clientName}>
              {invoice.clientName || "—"}
            </div>
            <div className="truncate text-xs text-muted-foreground" title={phone}>
              {phone}
            </div>
          </div>
        );
      },
    },
    {
      key: "order",
      header: t("invoices.columns.order"),
      cell: (invoice) => (
        <span className="block truncate text-center tabular-nums text-muted-foreground">
          {invoice.orderNumber || "—"}
        </span>
      ),
      className: "whitespace-nowrap text-center",
    },
  ];

  if (workflow.orderFields.device.visible) {
    columns.push({
      key: "device",
      header: copy.deviceLabel.replace(/\s*\*$/, ""),
      cell: (invoice) => (
        <span className="block max-w-[9rem] truncate" title={invoice.device}>
          {invoice.device || "—"}
        </span>
      ),
    });
  }
  if (workflow.orderFields.carNumber.visible) {
    columns.push({
      key: "carNumber",
      header: copy.carNumberLabel.replace(/\s*\*$/, ""),
      cell: (invoice) => <span className="tabular-nums text-muted-foreground">{invoice.carNumber || "—"}</span>,
      className: "whitespace-nowrap",
    });
  }
  if (workflow.orderFields.vin.visible) {
    columns.push({
      key: "vin",
      header: copy.vinLabel.replace(/\s*\*$/, ""),
      cell: (invoice) => (
        <span className="block max-w-[8rem] truncate font-mono text-[12px] text-muted-foreground" title={invoice.vin}>
          {invoice.vin || "—"}
        </span>
      ),
    });
  }

  columns.push(
    {
      key: "description",
      header: t("invoices.columns.description"),
      cell: (invoice) => (
        <span className="block max-w-[12rem] truncate text-muted-foreground" title={invoice.description}>
          {invoice.description || "—"}
        </span>
      ),
    },
    {
      key: "subtotal",
      header: t("invoices.columns.subtotal"),
      cell: (invoice) => <span className="tabular-nums text-muted-foreground">{formatMoney(invoice.subtotal)}</span>,
      className: "text-right whitespace-nowrap",
    },
    {
      key: "amount",
      header: t("invoices.columns.amount"),
      cell: (invoice) => <span className="font-medium text-foreground tabular-nums">{formatMoney(invoice.total)}</span>,
      className: "text-right whitespace-nowrap",
    },
    {
      key: "status",
      header: t("common.status"),
      cell: (invoice) => <InvoiceStatusBadge status={invoice.status} />,
    },
    {
      key: "paidAt",
      header: t("invoices.columns.paidAt"),
      cell: (invoice) => <span className="tabular-nums text-muted-foreground">{invoice.paidAt || "—"}</span>,
      className: "whitespace-nowrap",
    },
    {
      key: "created",
      header: t("invoices.columns.created"),
      cell: (invoice) => <span className="tabular-nums text-muted-foreground">{invoice.createdAt}</span>,
      className: "whitespace-nowrap",
    },
    {
      key: "createdBy",
      header: t("invoices.columns.createdBy"),
      cell: (invoice) => {
        const creator = invoice.createdByName?.trim() || t("invoices.columns.unknownCreator");
        return (
          <span className="block max-w-[10rem] truncate font-medium" title={creator}>
            {invoice.createdById ? creator : "—"}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: t("common.actions"),
      className: "w-[80px] text-right",
      cell: (invoice) => (
        <div className="flex justify-end">
          <InvoiceActionsMenu invoice={invoice} isUpdating={updateStatus.isPending} onStatusChange={handleStatusChange} />
        </div>
      ),
    },
  );

  const statusOptions = [
    { value: "all", label: t("invoices.allStatuses") },
    { value: "draft", label: t("status.invoice.draft") },
    { value: "sent", label: t("status.invoice.sent") },
    { value: "paid", label: t("status.invoice.paid") },
    { value: "overdue", label: t("status.invoice.overdue") },
  ];

  const isFiltered = searchQuery !== "" || statusFilter !== "all";

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("invoices.title")}
        description={isUnavailable ? t("invoices.notSetUp") : t("invoices.totalCount", { count: invoices.length })}
        actions={
          <Button onClick={() => setCreateModalOpen(true)} disabled={isUnavailable || isLoading}>
            <Plus />
            {t("invoices.createInvoice")}
          </Button>
        }
      />

      {(overdueCount > 0 || unpaidTotal > 0) && (
        <div className="grid sm:grid-cols-2 gap-3">
          {overdueCount > 0 && (
            <div role="status" className="flex items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                <AlertCircle aria-hidden="true" className="size-4" />
              </span>
              <div>
                <p className="text-sm font-medium text-destructive">
                  {t("invoices.summary.overdueCount", { count: overdueCount })}
                </p>
                <p className="text-[13px] text-destructive/80">{t("invoices.summary.requiresAttention")}</p>
              </div>
            </div>
          )}
          <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-xs">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-semibold text-primary">{currency}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground tabular-nums">{t("invoices.summary.unpaidAmount", { amount: formatMoney(unpaidTotal) })}</p>
              <p className="text-[13px] text-muted-foreground">{t("invoices.summary.outstandingBalance")}</p>
            </div>
          </div>
        </div>
      )}

      <SearchAndFilters
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t("invoices.searchPlaceholder")}
        filters={[
          {
            key: "status",
            label: t("common.status"),
            options: statusOptions,
            value: statusFilter,
            onChange: setStatusFilter,
          },
        ]}
        onClearFilters={() => {
          setSearchQuery("");
          setStatusFilter("all");
        }}
      />

      <DataTable
        columns={columns}
        data={filteredInvoices}
        keyExtractor={(invoice) => invoice.id}
        onRowClick={(invoice) => setOpenInvoiceId(invoice.id)}
        isLoading={isLoading}
        emptyState={
          isUnavailable ? (
            <EmptyState icon={FileX2} title={t("invoices.empty.unavailableTitle")} description={t("invoices.errors.unavailable")} />
          ) : error ? (
            <ErrorState title={t("invoices.empty.loadErrorTitle")} description={error.message} onRetry={() => refetch()} />
          ) : isFiltered ? (
            <EmptyState title={t("invoices.empty.filteredTitle")} description={t("invoices.empty.filteredDescription")} />
          ) : (
            <EmptyState icon={FileText} title={t("invoices.empty.title")} description={t("invoices.empty.description")} action={{ label: t("invoices.createInvoice"), onClick: () => setCreateModalOpen(true) }} />
          )
        }
      />

      <CreateInvoiceDialog open={createModalOpen} onOpenChange={setCreateModalOpen} orders={invoiceableOrders} />

      <InvoiceDetailPanel invoiceId={openInvoiceId} onClose={() => setOpenInvoiceId(null)} isUpdating={updateStatus.isPending} onStatusChange={handleStatusChange} />
    </div>
  );
}
