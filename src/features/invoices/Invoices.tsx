import { useState, useMemo } from "react";
import { Plus, AlertCircle, FileText, FileX2 } from "lucide-react";

import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { EmptyState, ErrorState } from "../../ui/EmptyState";
import { InvoiceStatusBadge } from "../../ui/StatusBadge";
import type { Invoice, InvoiceStatus } from "../../lib/types";
import { Button } from "../../ui/Button";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useGetOrders } from "../orders/useGetOrders";
import { invoicesUnavailableMessage } from "../../services/apiInvoices";
import { useGetInvoices } from "./useGetInvoices";
import { useUpdateInvoiceStatus } from "./useUpdateInvoiceStatus";
import { CreateInvoiceDialog } from "./CreateInvoiceDialog";
import { InvoiceActionsMenu } from "./InvoiceActionsMenu";
import { InvoiceDetailPanel } from "./InvoiceDetailPanel";

const statusOptions = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

export function Invoices() {
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
      header: "Invoice #",
      cell: (invoice) => <span className="font-medium text-primary tabular-nums">{invoice.invoiceNumber}</span>,
      className: "whitespace-nowrap",
    },
    {
      key: "client",
      header: "Client",
      cell: (invoice) => (
        <span className="block max-w-56 truncate" title={invoice.clientName}>
          {invoice.clientName || "—"}
        </span>
      ),
    },
    {
      key: "order",
      header: "Order",
      cell: (invoice) => <span className="text-sm text-muted-foreground tabular-nums">{invoice.orderNumber || "—"}</span>,
      className: "hidden xl:table-cell whitespace-nowrap",
    },
    {
      key: "created",
      header: "Created",
      cell: (invoice) => <span className="text-muted-foreground tabular-nums">{invoice.createdAt}</span>,
      className: "hidden lg:table-cell whitespace-nowrap",
    },
    {
      key: "amount",
      header: "Amount",
      cell: (invoice) => <span className="font-medium text-foreground tabular-nums">{formatMoney(invoice.amount)}</span>,
      className: "text-right whitespace-nowrap",
    },
    {
      key: "status",
      header: "Status",
      cell: (invoice) => <InvoiceStatusBadge status={invoice.status} />,
    },
    {
      key: "dueDate",
      header: "Due Date",
      cell: (invoice) => <span className={invoice.status === "overdue" ? "text-destructive tabular-nums" : "text-muted-foreground tabular-nums"}>{invoice.dueDate || "—"}</span>,
      className: "hidden xl:table-cell whitespace-nowrap",
    },
    {
      key: "actions",
      header: "Actions",
      className: "w-[80px] text-right",
      cell: (invoice) => (
        <div className="flex justify-end">
          <InvoiceActionsMenu invoice={invoice} isUpdating={updateStatus.isPending} onStatusChange={handleStatusChange} />
        </div>
      ),
    },
  ];

  const isFiltered = searchQuery !== "" || statusFilter !== "all";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Invoices"
        description={isUnavailable ? "Not set up yet" : `${invoices.length} total invoices`}
        actions={
          <Button onClick={() => setCreateModalOpen(true)} disabled={isUnavailable || isLoading}>
            <Plus />
            Create Invoice
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
                  {overdueCount} Overdue Invoice{overdueCount > 1 ? "s" : ""}
                </p>
                <p className="text-[13px] text-destructive/80">Requires immediate attention</p>
              </div>
            </div>
          )}
          <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-xs">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-semibold text-primary">{currency}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground tabular-nums">{formatMoney(unpaidTotal)} Unpaid</p>
              <p className="text-[13px] text-muted-foreground">Outstanding balance</p>
            </div>
          </div>
        </div>
      )}

      <SearchAndFilters
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search invoices..."
        filters={[
          {
            key: "status",
            label: "Status",
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
            <EmptyState icon={FileX2} title="Invoices are not set up yet" description={invoicesUnavailableMessage} />
          ) : error ? (
            <ErrorState title="Could not load invoices" description={error.message} onRetry={() => refetch()} />
          ) : isFiltered ? (
            <EmptyState title="No invoices match your filters" description="Try a different search term or clear the filters." />
          ) : (
            <EmptyState icon={FileText} title="No invoices yet" description="Create an invoice from an order to bill its services." action={{ label: "Create Invoice", onClick: () => setCreateModalOpen(true) }} />
          )
        }
      />

      <CreateInvoiceDialog open={createModalOpen} onOpenChange={setCreateModalOpen} orders={invoiceableOrders} />

      <InvoiceDetailPanel invoiceId={openInvoiceId} onClose={() => setOpenInvoiceId(null)} isUpdating={updateStatus.isPending} onStatusChange={handleStatusChange} />
    </div>
  );
}
