import { useState } from "react";
import { Plus, Phone, Mail, Pencil } from "lucide-react";
import { Button } from "../../ui/Button";

import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { NoClients, NoSearchResults } from "../../ui/EmptyState";
import type { Client, ClientListFilter } from "../../lib/types";
import ClientTypeBadge from "./ClientTypeBadge";
import { AddClientDialog } from "./AddClientDialog";
import EditClientForm from "./EditClientForm";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { useGetClients } from "./useGetClients";
import { useDebounce } from "../../hooks/useDebounce";
import ClientDetailPanel from "./ClientDetailPanel";
import { useGetOrders } from "../orders/useGetOrders";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
export function Clients() {
  const [searchQuery, setSearchQuery] = useState("");
  const [clientType, setClientType] = useState<ClientListFilter>("all");
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const debounceSearch = useDebounce(searchQuery, 400);
  const { isLoading, clients = [], isPending, error: clientsError } = useGetClients(debounceSearch, clientType);
  const { orders, isLoading: ordersLoading } = useGetOrders();
  const { formatMoney } = useWorkspaceMoney();

  // State
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  const getClientOrders = (clientId: string) => {
    return orders
      .filter((order) => order.clientId === clientId)
      .map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        device: order.device,
        service: order.service,
        totalPrice: order.totalPrice,
      }));
  };

  // Table columns
  const columns: Column<Client>[] = [
    {
      key: "name",
      header: "Name",
      cell: (client) => (
        <span className="font-medium text-[#282e33]">{client.name}</span>
      ),
    },
    {
      key: "clientType",
      header: "Client Type",
      cell: (client) => <ClientTypeBadge clientType={client.client_type} />,
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
      cell: (client) => <span className={client.balance > 0 ? "text-[#f41f20] font-medium" : "text-[#282e33]"}>{formatMoney(client.balance)}</span>,
      className: "text-right",
    },
    {
      key: "created",
      header: "Added",
      cell: (client) => <span className="text-[#939699]">{client.created_at.split("T")[0]}</span>,
      className: "hidden md:table-cell",
    },
    {
      key: "actions",
      header: "Actions",
      className: "w-[80px] text-right",
      cell: (client) => (
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={`Edit ${client.name}`}
            onClick={(event) => {
              event.stopPropagation();
              setEditingClient(client);
            }}
          >
            <Pencil />
          </Button>
        </div>
      ),
    },
  ];

  const handleRowClick = (client: Client) => {
    setSelectedClient(client);
    setDetailPanelOpen(true);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Clients"
        description={isPending ? "Loading clients..." : `${clients.length} total clients`}
        actions={
          <Button onClick={() => setCreateModalOpen(true)} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
            <Plus className="h-4 w-4 mr-1" />
            Add Client
          </Button>
        }
      />

      <SearchAndFilters
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search by name, tax ID, contact, email, or phone..."
        filters={[
          {
            key: "clientType",
            label: "Client type",
            value: clientType,
            onChange: (value) => setClientType(value as ClientListFilter),
            options: [
              { value: "all", label: "All" },
              { value: "individual", label: "Individuals" },
              { value: "organization", label: "Organizations" },
            ],
          },
        ]}
        onClearFilters={() => setClientType("all")}
      />

      {clientsError && <p className="text-sm text-[#f41f20]">{clientsError.message}</p>}

      <DataTable
        columns={columns}
        data={clients}
        isLoading={isLoading || ordersLoading}
        keyExtractor={(client) => client.id}
        onRowClick={handleRowClick}
        emptyState={searchQuery || clientType !== "all" ? <NoSearchResults query={searchQuery || (clientType === "organization" ? "Organizations" : "Individuals")} /> : <NoClients onAddClient={() => setCreateModalOpen(true)} />}
      />

      {/* {isLoading && <FullPageDataSpinner />} */}


      {/* Create Client Modal */}
      <AddClientDialog open={createModalOpen} onOpenChange={setCreateModalOpen} />

      <Dialog
        open={Boolean(editingClient)}
        onOpenChange={(open) => {
          if (!open) setEditingClient(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Client</DialogTitle>
            <DialogDescription className="sr-only">Update the selected client's details.</DialogDescription>
          </DialogHeader>
          {editingClient && (
            <EditClientForm
              key={editingClient.id}
              client={editingClient}
              onCancel={() => setEditingClient(null)}
              onUpdated={(client) => {
                setSelectedClient((current) => (current?.id === client.id ? client : current));
                setEditingClient(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Client Detail Panel */}
      
      <ClientDetailPanel
        selectedClient={selectedClient}
        setDetailPanelOpen={setDetailPanelOpen}
        detailPanelOpen={detailPanelOpen}
        getClientOrders={getClientOrders}
        onClientUpdated={setSelectedClient}
      />
    </div>
  );
}
