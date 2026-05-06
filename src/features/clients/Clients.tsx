import { useState, useMemo } from "react";
import { Plus, Phone, Mail, MapPin } from "lucide-react";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Textarea } from "../../ui/Textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { NoClients, NoSearchResults } from "../../ui/EmptyState";
import { Spinner } from "../../ui/Spinner";
import { useApp } from "../../lib/appContext";
import type { Client, Order } from "../../lib/types";

export function Clients() {
  const { clients, orders, addClient } = useApp();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    notes: "",
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filtered data
  const filteredClients = useMemo(() => {
    if (!searchQuery) return clients;
    const query = searchQuery.toLowerCase();
    return clients.filter((client) => client.name.toLowerCase().includes(query) || client.email.toLowerCase().includes(query) || client.phone.includes(query));
  }, [clients, searchQuery]);

  // Get client orders
  const getClientOrders = (clientId: string): Order[] => {
    return orders.filter((order) => order.clientId === clientId);
  };

  // Table columns
  const columns: Column<Client>[] = [
    {
      key: "name",
      header: "Name",
      cell: (client) => <span className="font-medium text-[#282e33]">{client.name}</span>,
    },
    {
      key: "contact",
      header: "Contact",
      cell: (client) => (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-sm">
            <Mail className="h-3 w-3 text-[#939699]" />
            <span className="text-[#282e33]">{client.email}</span>
          </div>
          <div className="flex items-center gap-1 text-sm">
            <Phone className="h-3 w-3 text-[#939699]" />
            <span className="text-[#939699]">{client.phone}</span>
          </div>
        </div>
      ),
      className: "hidden sm:table-cell",
    },
    {
      key: "orders",
      header: "Orders",
      cell: (client) => {
        const clientOrders = getClientOrders(client.id);
        return <span>{clientOrders.length}</span>;
      },
    },
    {
      key: "balance",
      header: "Balance",
      cell: (client) => <span className={client.balance > 0 ? "text-[#f41f20] font-medium" : "text-[#282e33]"}>${client.balance}</span>,
      className: "text-right",
    },
    {
      key: "created",
      header: "Added",
      cell: (client) => <span className="text-[#939699]">{client.createdAt}</span>,
      className: "hidden md:table-cell",
    },
  ];

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.name.trim()) errors.name = "Name is required";
    if (!formData.email.trim()) errors.email = "Email is required";
    if (!formData.phone.trim()) errors.phone = "Phone is required";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateClient = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 800));

    addClient({
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      address: formData.address,
      notes: formData.notes,
    });

    setIsSubmitting(false);
    setCreateModalOpen(false);
    setFormData({ name: "", email: "", phone: "", address: "", notes: "" });
  };

  const handleRowClick = (client: Client) => {
    setSelectedClient(client);
    setDetailPanelOpen(true);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Clients"
        description={`${clients.length} total clients`}
        actions={
          <Button onClick={() => setCreateModalOpen(true)} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
            <Plus className="h-4 w-4 mr-1" />
            Add Client
          </Button>
        }
      />

      <SearchAndFilters searchValue={searchQuery} onSearchChange={setSearchQuery} searchPlaceholder="Search by name, email, or phone..." />

      <DataTable
        columns={columns}
        data={filteredClients}
        keyExtractor={(client) => client.id}
        onRowClick={handleRowClick}
        emptyState={searchQuery ? <NoSearchResults query={searchQuery} /> : <NoClients onAddClient={() => setCreateModalOpen(true)} />}
      />

      {/* Create Client Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Client</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Client name" className={formErrors.name ? "border-[#f41f20]" : ""} />
              {formErrors.name && <p className="text-xs text-[#f41f20]">{formErrors.name}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="email@example.com"
                  className={formErrors.email ? "border-[#f41f20]" : ""}
                />
                {formErrors.email && <p className="text-xs text-[#f41f20]">{formErrors.email}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Phone *</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+1 (555) 000-0000"
                  className={formErrors.phone ? "border-[#f41f20]" : ""}
                />
                {formErrors.phone && <p className="text-xs text-[#f41f20]">{formErrors.phone}</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="Street address, city, state" />
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Additional notes about this client..." rows={3} />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateModalOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleCreateClient} disabled={isSubmitting} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
              {isSubmitting ? <Spinner className="h-4 w-4" /> : "Add Client"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Client Detail Panel */}
      <Sheet open={detailPanelOpen} onOpenChange={setDetailPanelOpen}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{selectedClient?.name}</SheetTitle>
          </SheetHeader>

          {selectedClient && (
            <div className="mt-6 space-y-6">
              {/* Contact Info */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-[#939699]">Contact Information</h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-[#939699]" />
                    <a href={`mailto:${selectedClient.email}`} className="text-[#1973e1] hover:underline">
                      {selectedClient.email}
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-[#939699]" />
                    <a href={`tel:${selectedClient.phone}`} className="text-[#282e33]">
                      {selectedClient.phone}
                    </a>
                  </div>
                  {selectedClient.address && (
                    <div className="flex items-start gap-2">
                      <MapPin className="h-4 w-4 text-[#939699] mt-0.5" />
                      <span className="text-[#282e33]">{selectedClient.address}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Balance */}
              <div className="bg-[#f8f9fa] rounded-md p-4">
                <p className="text-sm text-[#939699]">Current Balance</p>
                <p className={`text-2xl font-semibold ${selectedClient.balance > 0 ? "text-[#f41f20]" : "text-[#282e33]"}`}>${selectedClient.balance}</p>
              </div>

              {/* Order History */}
              <div>
                <h3 className="text-sm font-medium text-[#939699] mb-3">Order History</h3>
                {(() => {
                  const clientOrders = getClientOrders(selectedClient.id);
                  if (clientOrders.length === 0) {
                    return <p className="text-sm text-[#939699] py-4 text-center">No orders yet</p>;
                  }
                  return (
                    <div className="space-y-2">
                      {clientOrders.slice(0, 5).map((order) => (
                        <div key={order.id} className="flex items-center justify-between p-3 bg-[#f8f9fa] rounded-md">
                          <div>
                            <p className="font-medium text-[#282e33]">{order.orderNumber}</p>
                            <p className="text-xs text-[#939699]">
                              {order.device} - {order.service}
                            </p>
                          </div>
                          <p className="font-medium text-[#282e33]">${order.totalPrice}</p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Notes */}
              {selectedClient.notes && (
                <div>
                  <h3 className="text-sm font-medium text-[#939699] mb-2">Notes</h3>
                  <p className="text-sm text-[#282e33]">{selectedClient.notes}</p>
                </div>
              )}

              {/* Timestamps */}
              <div className="text-xs text-[#939699]">
                <p>Client since: {selectedClient.createdAt}</p>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
