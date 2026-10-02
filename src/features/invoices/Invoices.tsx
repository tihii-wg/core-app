import { useState, useMemo } from "react";
import { Plus, Check, AlertCircle } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { InvoiceStatusBadge } from "../../ui/StatusBadge";
import { Spinner } from "../../ui/Spinner";
import type { Invoice, InvoiceStatus } from "../../lib/types";
import { Label } from "../../ui/Label";
import { Input } from "../../ui/Input";
import { Button } from "../../ui/Button";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { DemoDataNotice } from "../demo/DemoDataNotice";
import { useInvoiceActions, useInvoiceFormOptions, useInvoices } from "./useInvoices";

const NO_ORDER = "none";

const statusOptions = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

export function Invoices() {
  const { data: invoices, isDemo } = useInvoices();
  const {
    data: { clients, orders },
  } = useInvoiceFormOptions();
  const { createInvoice, markInvoicePaid } = useInvoiceActions();
  const { currency, formatMoney } = useWorkspaceMoney();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    clientId: "",
    orderId: NO_ORDER,
    amount: "",
    dueDate: "",
    status: "draft" as InvoiceStatus,
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Stats
  const overdueCount = invoices.filter((i) => i.status === "overdue").length;
  const unpaidTotal = invoices.filter((i) => i.status === "sent" || i.status === "overdue").reduce((sum, i) => sum + i.amount, 0);

  // Get unpaid orders for a client
  const getClientOrders = (clientId: string) => {
    return orders.filter((o) => o.clientId === clientId && !o.isPaid);
  };

  // Filtered data
  const filteredInvoices = useMemo(() => {
    return invoices.filter((invoice) => {
      const matchesSearch = !searchQuery || invoice.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) || invoice.clientName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === "all" || invoice.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [invoices, searchQuery, statusFilter]);

  // Table columns
  const columns: Column<Invoice>[] = [
    {
      key: "invoiceNumber",
      header: "Invoice #",
      cell: (invoice) => <span className="font-medium text-primary tabular-nums">{invoice.invoiceNumber}</span>,
    },
    {
      key: "client",
      header: "Client",
      cell: (invoice) => (
        <span className="block max-w-56 truncate" title={invoice.clientName}>
          {invoice.clientName}
        </span>
      ),
    },
    {
      key: "order",
      header: "Order",
      cell: (invoice) => (invoice.orderNumber ? <span className="text-sm text-muted-foreground">{invoice.orderNumber}</span> : <span className="text-sm text-muted-foreground">-</span>),
      className: "hidden xl:table-cell",
    },
    {
      key: "amount",
      header: "Amount",
      cell: (invoice) => <span className="font-medium text-foreground tabular-nums">{formatMoney(invoice.amount)}</span>,
      className: "text-right",
    },
    {
      key: "status",
      header: "Status",
      cell: (invoice) => <InvoiceStatusBadge status={invoice.status} />,
    },
    {
      key: "dueDate",
      header: "Due Date",
      cell: (invoice) => <span className={invoice.status === "overdue" ? "text-destructive" : "text-muted-foreground"}>{invoice.dueDate}</span>,
      className: "hidden xl:table-cell",
    },
    {
      key: "actions",
      header: "",
      cell: (invoice) =>
        invoice.status !== "paid" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              void markInvoicePaid(invoice.id);
            }}
            className="text-success hover:text-success hover:bg-success/10"
          >
            <Check />
            Mark Paid
          </Button>
        ),
    },
  ];

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.clientId) errors.clientId = "Client is required";
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      errors.amount = "Valid amount is required";
    }
    if (!formData.dueDate) errors.dueDate = "Due date is required";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateInvoice = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      await createInvoice({
        clientId: formData.clientId,
        orderId: formData.orderId === NO_ORDER ? undefined : formData.orderId,
        amount: parseFloat(formData.amount),
        status: formData.status,
        dueDate: formData.dueDate,
      });
      setCreateModalOpen(false);
      setFormData({
        clientId: "",
        orderId: NO_ORDER,
        amount: "",
        dueDate: "",
        status: "draft",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Invoices"
        description={isDemo ? `${invoices.length} sample invoices` : `${invoices.length} total invoices`}
        actions={
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus />
            Create Invoice
          </Button>
        }
      />

      {isDemo && (
        <DemoDataNotice title="Invoices are not connected to your workspace yet">
          These sample invoices preview the layout only. They are not your clients or orders, and anything you create here is kept in this browser session and discarded on reload.
        </DemoDataNotice>
      )}

      {/* Alerts */}
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

      <DataTable columns={columns} data={filteredInvoices} keyExtractor={(invoice) => invoice.id} />

      {/* Create Invoice Modal */}
      <Dialog
        open={createModalOpen}
        onOpenChange={(open) => {
          setCreateModalOpen(open);
          if (!open) setFormErrors({});
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Invoice</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invoice-client">Client *</Label>
              <Select
                value={formData.clientId}
                onValueChange={(value) => {
                  setFormData({ ...formData, clientId: value, orderId: NO_ORDER });
                }}
              >
                <SelectTrigger id="invoice-client" className={`w-full ${formErrors.clientId ? "border-destructive" : ""}`}>
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formErrors.clientId && <p className="text-xs text-destructive">{formErrors.clientId}</p>}
            </div>

            {formData.clientId && (
              <div className="space-y-1.5">
                <Label htmlFor="invoice-order">Related Order (optional)</Label>
                <Select value={formData.orderId} onValueChange={(value) => setFormData({ ...formData, orderId: value })}>
                  <SelectTrigger id="invoice-order" className="w-full">
                    <SelectValue placeholder="Select order" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ORDER}>No related order</SelectItem>
                    {getClientOrders(formData.clientId).map((order) => (
                      <SelectItem key={order.id} value={order.id}>
                        {order.orderNumber} - {order.device} ({formatMoney(order.totalPrice)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="invoice-amount">Amount ({currency}) *</Label>
                <Input
                  id="invoice-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="0.00"
                  className={formErrors.amount ? "border-destructive" : ""}
                />
                {formErrors.amount && <p className="text-xs text-destructive">{formErrors.amount}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="invoice-status">Status</Label>
                <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value as InvoiceStatus })}>
                  <SelectTrigger id="invoice-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="invoice-due-date">Due Date *</Label>
              <Input id="invoice-due-date" type="date" value={formData.dueDate} onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })} className={formErrors.dueDate ? "border-destructive" : ""} />
              {formErrors.dueDate && <p className="text-xs text-destructive">{formErrors.dueDate}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateModalOpen(false);
                setFormErrors({});
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateInvoice} disabled={isSubmitting}>
              {isSubmitting ? <Spinner className="h-4 w-4" /> : "Create Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
