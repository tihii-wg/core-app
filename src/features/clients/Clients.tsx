import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Phone, Mail, Pencil } from "lucide-react";
import { Button } from "../../ui/Button";

import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { ErrorState, NoClients, NoSearchResults } from "../../ui/EmptyState";
import type { Client, ClientListFilter } from "../../lib/types";
import ClientTypeBadge from "./ClientTypeBadge";
import { AddClientDialog } from "./AddClientDialog";
import EditClientForm from "./EditClientForm";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { useGetClients } from "./useGetClients";
import { useDebounce } from "../../hooks/useDebounce";
import ClientDetailPanel from "./ClientDetailPanel";
import { clientOrderSummaries } from "./clientOrders";
import { useGetOrders } from "../orders/useGetOrders";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
export function Clients() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [clientType, setClientType] = useState<ClientListFilter>("all");
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const debounceSearch = useDebounce(searchQuery, 400);
  const { isLoading, clients = [], isPending, error: clientsError, refetch: refetchClients } = useGetClients(debounceSearch, clientType);
  const { orders, isLoading: ordersLoading } = useGetOrders();
  const { formatMoney } = useWorkspaceMoney();

  // State
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  const getClientOrders = (clientId: string) => clientOrderSummaries(orders, clientId);

  // Table columns
  const columns: Column<Client>[] = [
    {
      key: "name",
      header: t("clients.table.name"),
      cell: (client) => (
        <span className="block max-w-[12rem] truncate font-medium text-foreground xl:max-w-[14rem] 2xl:max-w-[16rem]" title={client.name}>
          {client.name}
        </span>
      ),
    },
    {
      key: "clientType",
      header: t("clients.table.clientType"),
      cell: (client) => <ClientTypeBadge clientType={client.client_type} />,
    },

    {
      key: "contact",
      header: t("clients.table.contact"),
      cell: (client) => (
        <div className="max-w-[12rem] min-w-0 space-y-0.5 xl:max-w-[13rem] 2xl:max-w-[15rem]">
          {client.email && (
            <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
              <Mail aria-hidden="true" className="size-3 shrink-0 text-subtle-foreground" />
              <span className="truncate text-foreground" title={client.email}>{client.email}</span>
            </div>
          )}
          {client.phone && (
            <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
              <Phone aria-hidden="true" className="size-3 shrink-0 text-subtle-foreground" />
              <span className="truncate text-muted-foreground tabular-nums">{client.phone}</span>
            </div>
          )}
          {!client.email && !client.phone && <span className="text-subtle-foreground">—</span>}
        </div>
      ),
      className: "hidden xl:table-cell",
    },
    {
      key: "orders",
      header: t("clients.table.orders"),
      cell: (client) => {
        const clientOrders = getClientOrders(client.id);
        return <span className="tabular-nums">{clientOrders.length}</span>;
      },
      className: "text-right",
    },
    {
      key: "balance",
      header: t("clients.table.balance"),
      cell: (client) => <span className={client.balance > 0 ? "font-medium text-destructive tabular-nums" : "text-foreground tabular-nums"}>{formatMoney(client.balance)}</span>,
      className: "text-right whitespace-nowrap",
    },
    {
      key: "created",
      header: t("clients.table.added"),
      cell: (client) => <span className="text-muted-foreground tabular-nums">{client.created_at.split("T")[0]}</span>,
      className: "hidden xl:table-cell whitespace-nowrap",
    },
    {
      key: "actions",
      header: t("common.actions"),
      className: "w-[80px] text-right",
      cell: (client) => (
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("clients.editClientLabel", { name: client.name })}
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
    <div className="space-y-5">
      <PageHeader
        title={t("clients.title")}
        description={isPending ? t("clients.loading") : t("clients.totalCount", { count: clients.length })}
        actions={
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus />
            {t("clients.addClient")}
          </Button>
        }
      />

      <SearchAndFilters
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t("clients.searchPlaceholder")}
        filters={[
          {
            key: "clientType",
            label: t("clients.filters.clientType"),
            value: clientType,
            onChange: (value) => setClientType(value as ClientListFilter),
            options: [
              { value: "all", label: t("common.all") },
              { value: "individual", label: t("clients.filters.individuals") },
              { value: "organization", label: t("clients.filters.organizations") },
            ],
          },
        ]}
        onClearFilters={() => setClientType("all")}
      />

      <DataTable
        columns={columns}
        data={clients}
        isLoading={isLoading || ordersLoading}
        keyExtractor={(client) => client.id}
        onRowClick={handleRowClick}
        emptyState={
          clientsError ? (
            <ErrorState title={t("clients.errors.loadFailed")} description={clientsError.message} onRetry={() => refetchClients()} />
          ) : searchQuery || clientType !== "all" ? (
            <NoSearchResults query={searchQuery || (clientType === "organization" ? t("clients.filters.organizations") : t("clients.filters.individuals"))} />
          ) : (
            <NoClients onAddClient={() => setCreateModalOpen(true)} />
          )
        }
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
            <DialogTitle>{t("clients.editDialog.title")}</DialogTitle>
            <DialogDescription className="sr-only">{t("clients.editDialog.description")}</DialogDescription>
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
