import { useState } from "react";
import { Plus, Phone, Mail } from "lucide-react";
import { Button } from "../../ui/Button";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { NoClients, NoSearchResults } from "../../ui/EmptyState";
// import { useApp } from "../../lib/appContext";
import type { Client, Order } from "../../lib/types";
import AddNewClientForm from "./AddNewClienForm";
import { useGetClients } from "./useGetClients";
import { Spinner } from "../../ui/Spinner";
import { useDebounce } from "../../hooks/useDebounce";
import ClientDetailPanel from "./ClientDetailPanel";
import { useApp } from "../../lib/appContext";

export function Clients() {
  const [searchQuery, setSearchQuery] = useState("");
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const { orders } = useApp();
  const debounceSearch = useDebounce(searchQuery, 400);
  const { isLoading, clients, isPending } = useGetClients(debounceSearch);

  // State
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
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
      cell: (client) => <span className="text-[#939699]">{client.created_at.split("T")[0]}</span>,
      className: "hidden md:table-cell",
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

      <SearchAndFilters searchValue={searchQuery} onSearchChange={setSearchQuery} searchPlaceholder="Search by name, email, or phone..." />

      <DataTable
        columns={columns}
        data={clients}
        keyExtractor={(client) => client.id}
        onRowClick={handleRowClick}
        emptyState={searchQuery ? <NoSearchResults query={searchQuery} /> : <NoClients onAddClient={() => setCreateModalOpen(true)} />}
      />

      {isLoading && (
        <div className="flex justify-center mt-30">
          <Spinner className="size-15 text-blue-600" />
        </div>
      )}
      {/* Create Client Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Client</DialogTitle>
            <DialogDescription>Fill in client details below</DialogDescription>
          </DialogHeader>

          <AddNewClientForm setCreateModalOpen={setCreateModalOpen} />
        </DialogContent>
      </Dialog>

      {/* Client Detail Panel */}
      <ClientDetailPanel selectedClient={selectedClient} setDetailPanelOpen={setDetailPanelOpen} detailPanelOpen={detailPanelOpen} getClientOrders={getClientOrders} />
    </div>
  );
}
