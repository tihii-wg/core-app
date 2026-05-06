

import { useState, useMemo } from "react";
import { Plus, Check, AlertCircle } from "lucide-react";


import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/Select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../ui/Dialog";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { InvoiceStatusBadge } from "../../ui/StatusBadge";
import { Spinner } from "../../ui/Spinner";
import { useApp } from "../..//lib/app-context";
import type { Invoice, InvoiceStatus } from "../../lib/types";
import { Label } from "../../ui/Label";
import { Input } from "../../ui/Input";
import { Button } from "../../ui/Button";

const statusOptions = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

export function Invoices() {
  const { invoices, clients, orders, addInvoice, updateInvoiceStatus } =
    useApp();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    clientId: "",
    orderId: "",
    amount: "",
    dueDate: "",
    status: "draft" as InvoiceStatus,
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Stats
  const overdueCount = invoices.filter((i) => i.status === "overdue").length;
  const unpaidTotal = invoices
    .filter((i) => i.status === "sent" || i.status === "overdue")
    .reduce((sum, i) => sum + i.amount, 0);

  // Get unpaid orders for a client
  const getClientOrders = (clientId: string) => {
    return orders.filter(
      (o) => o.clientId === clientId && o.paymentStatus !== "paid"
    );
  };

  // Filtered data
  const filteredInvoices = useMemo(() => {
    return invoices.filter((invoice) => {
      const matchesSearch =
        !searchQuery ||
        invoice.invoiceNumber
          .toLowerCase()
          .includes(searchQuery.toLowerCase()) ||
        invoice.clientName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus =
        statusFilter === "all" || invoice.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [invoices, searchQuery, statusFilter]);

  // Table columns
  const columns: Column<Invoice>[] = [
    {
      key: "invoiceNumber",
      header: "Invoice #",
      cell: (invoice) => (
        <span className="font-medium text-[#1973e1]">
          {invoice.invoiceNumber}
        </span>
      ),
    },
    {
      key: "client",
      header: "Client",
      cell: (invoice) => invoice.clientName,
    },
    {
      key: "order",
      header: "Order",
      cell: (invoice) =>
        invoice.orderNumber ? (
          <span className="text-sm text-[#939699]">{invoice.orderNumber}</span>
        ) : (
          <span className="text-sm text-[#939699]">-</span>
        ),
      className: "hidden sm:table-cell",
    },
    {
      key: "amount",
      header: "Amount",
      cell: (invoice) => (
        <span className="font-medium text-[#282e33]">${invoice.amount}</span>
      ),
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
      cell: (invoice) => (
        <span
          className={
            invoice.status === "overdue" ? "text-[#f41f20]" : "text-[#939699]"
          }
        >
          {invoice.dueDate}
        </span>
      ),
      className: "hidden md:table-cell",
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
              updateInvoiceStatus(invoice.id, "paid");
            }}
            className="text-[#099b49] hover:text-[#067d3a] hover:bg-[#e6f7ed]"
          >
            <Check className="h-4 w-4 mr-1" />
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
    await new Promise((resolve) => setTimeout(resolve, 800));

    const client = clients.find((c) => c.id === formData.clientId);
    const order = orders.find((o) => o.id === formData.orderId);

    addInvoice({
      clientId: formData.clientId,
      clientName: client?.name || "",
      orderId: formData.orderId || undefined,
      orderNumber: order?.orderNumber || undefined,
      amount: parseFloat(formData.amount),
      status: formData.status,
      dueDate: formData.dueDate,
    });

    setIsSubmitting(false);
    setCreateModalOpen(false);
    setFormData({
      clientId: "",
      orderId: "",
      amount: "",
      dueDate: "",
      status: "draft",
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Invoices"
        description={`${invoices.length} total invoices`}
        actions={
          <Button
            onClick={() => setCreateModalOpen(true)}
            className="bg-[#1973e1] hover:bg-[#1565c0] text-white"
          >
            <Plus className="h-4 w-4 mr-1" />
            Create Invoice
          </Button>
        }
      />

      {/* Alerts */}
      {(overdueCount > 0 || unpaidTotal > 0) && (
        <div className="grid sm:grid-cols-2 gap-4">
          {overdueCount > 0 && (
            <div className="flex items-center gap-3 p-4 bg-[#fee7e7] rounded-md">
              <AlertCircle className="h-5 w-5 text-[#f41f20]" />
              <div>
                <p className="font-medium text-[#f41f20]">
                  {overdueCount} Overdue Invoice{overdueCount > 1 ? "s" : ""}
                </p>
                <p className="text-sm text-[#f41f20]/80">
                  Requires immediate attention
                </p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 p-4 bg-[#f8f9fa] rounded-md">
            <div className="h-10 w-10 bg-[#edf4fd] rounded-full flex items-center justify-center">
              <span className="text-[#1973e1] font-bold">$</span>
            </div>
            <div>
              <p className="font-medium text-[#282e33]">
                ${unpaidTotal.toLocaleString()} Unpaid
              </p>
              <p className="text-sm text-[#939699]">Outstanding balance</p>
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
      />

      {/* Create Invoice Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Invoice</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Client *</Label>
              <Select
                value={formData.clientId}
                onValueChange={(value) => {
                  setFormData({ ...formData, clientId: value, orderId: "" });
                }}
              >
                <SelectTrigger
                  className={formErrors.clientId ? "border-[#f41f20]" : ""}
                >
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
              {formErrors.clientId && (
                <p className="text-xs text-[#f41f20]">{formErrors.clientId}</p>
              )}
            </div>

            {formData.clientId && (
              <div className="space-y-1.5">
                <Label>Related Order (optional)</Label>
                <Select
                  value={formData.orderId}
                  onValueChange={(value) =>
                    setFormData({ ...formData, orderId: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select order" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No related order</SelectItem>
                    {getClientOrders(formData.clientId).map((order) => (
                      <SelectItem key={order.id} value={order.id}>
                        {order.orderNumber} - {order.device} ($
                        {order.totalPrice})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Amount ($) *</Label>
                <Input
                  type="number"
                  value={formData.amount}
                  onChange={(e) =>
                    setFormData({ ...formData, amount: e.target.value })
                  }
                  placeholder="0.00"
                  className={formErrors.amount ? "border-[#f41f20]" : ""}
                />
                {formErrors.amount && (
                  <p className="text-xs text-[#f41f20]">{formErrors.amount}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) =>
                    setFormData({ ...formData, status: value as InvoiceStatus })
                  }
                >
                  <SelectTrigger>
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
              <Label>Due Date *</Label>
              <Input
                type="date"
                value={formData.dueDate}
                onChange={(e) =>
                  setFormData({ ...formData, dueDate: e.target.value })
                }
                className={formErrors.dueDate ? "border-[#f41f20]" : ""}
              />
              {formErrors.dueDate && (
                <p className="text-xs text-[#f41f20]">{formErrors.dueDate}</p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setCreateModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateInvoice}
              disabled={isSubmitting}
              className="bg-[#1973e1] hover:bg-[#1565c0] text-white"
            >
              {isSubmitting ? (
                <Spinner className="h-4 w-4" />
              ) : (
                "Create Invoice"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
