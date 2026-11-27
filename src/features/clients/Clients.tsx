import { DialogLauncher, type DialogLauncherHandle } from "../../ui/DialogLauncher";
import { useFormFieldLayout } from "../formFields/useFormFields";
import { useStableCallback } from "../../lib/useStableCallback";
import { ClientNameWithMark } from "./ClientNameWithMark";
import { useEffect, useMemo, useRef, useState } from "react";
import { useListTopAnchor } from "../../hooks/useListTopAnchor";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Merge, Plus, Phone, Pencil, Trash2 } from "lucide-react";
import { Button } from "../../ui/Button";

import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { ErrorState, NoClients, NoSearchResults } from "../../ui/EmptyState";
import type { Client, ClientListFilter } from "../../lib/types";
import ClientTypeBadge from "./ClientTypeBadge";
import { AddClientDialog } from "./AddClientDialog";
import EditClientForm from "./EditClientForm";
import { DeleteClientDialog } from "./DeleteClientDialog";
import { MergeClientsDialog } from "./MergeClientsDialog";
import { ClientColumnsMenu } from "./ClientColumnsMenu";
import {
  readClientVisibleColumns,
  writeClientVisibleColumns,
  type ClientToggleableColumn,
} from "./clientColumnVisibility";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { useClientsPage } from "./useGetClients";
import { ServerListPager } from "../../ui/ServerListPager";
import { DEFAULT_LIST_PAGE_SIZE, type ListPageSize } from "../../lib/serverPaging";
import { useDebounce } from "../../hooks/useDebounce";
import { useIsMobile } from "../../hooks/use-mobile";
import { Skeleton } from "../../ui/Skeleton";
import { ClientCard } from "./ClientCard";
import ClientDetailPanel from "./ClientDetailPanel";
import { clientOrderSummaries } from "./clientOrders";
import { useClientOrderCounts, useClientOrders } from "../orders/useGetOrders";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { industryClientCopy, industryClientTotalCount } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { CreateOrderDialog } from "../orders/CreateOrderDialog";
import OrderDetailPanel from "../orders/OrderDetailPanel";
import { useOrderDetails } from "../orders/useOrderDetails";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { SubscriptionReadOnlyNotice } from "../workspaces/SubscriptionReadOnlyNotice";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { getClient } from "../../services/apiClients";

export function Clients() {
  const { t } = useTranslation();
  const fieldLabels = useFormFieldLayout("client");
  const isMobile = useIsMobile();
  const { workflow } = useIndustryWorkflow();
  const clientCopy = industryClientCopy(workflow);
  const { canWrite: canMutateClients } = useWorkspaceSubscription();
  const [searchQuery, setSearchQuery] = useState("");
  const [clientType, setClientType] = useState<ClientListFilter>("all");
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const debounceSearch = useDebounce(searchQuery, 400);
  const { workspaceId } = useActiveWorkspaceId();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<ListPageSize>(DEFAULT_LIST_PAGE_SIZE);
  // After a page switch the list starts at the top of the screen (filters scroll out of view).
  const listTop = useListTopAnchor();
  // Paginated in the database: only one page of clients is loaded (search / type filter run there too).
  const {
    data: clientsPage,
    isLoading,
    isPending,
    error: clientsError,
    refetch: refetchClients,
  } = useClientsPage({ search: debounceSearch, clientType, page, pageSize });
  const clients = useMemo(() => clientsPage?.rows ?? [], [clientsPage]);
  const totalClients = clientsPage?.total ?? 0;
  const resolvedPage = clientsPage?.page ?? page;
  useEffect(() => {
    setPage(1);
  }, [debounceSearch, clientType, pageSize]);
  // Order counts for the clients of this page only; the client card loads that client's orders itself.
  const { counts: orderCountByClientId } = useClientOrderCounts(clients.map((client) => client.id));
  const { formatMoney } = useWorkspaceMoney();
  const orderDetails = useOrderDetails();

  // Dialog state lives in the launchers: opening a dialog must not re-render the whole client list.
  const addClientLauncher = useRef<DialogLauncherHandle>(null);
  const mergeLauncher = useRef<DialogLauncherHandle>(null);
  const openAddClient = () => addClientLauncher.current?.open();
  const [orderForClient, setOrderForClient] = useState<Client | null>(null);
  const [orderForVehicleId, setOrderForVehicleId] = useState<string | null>(null);
  const [createKind, setCreateKind] = useState<"order" | "estimate">("order");

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const {
    orders,
    isLoading: ordersLoading,
    error: ordersError,
  } = useClientOrders(selectedClient?.id, { enabled: detailPanelOpen });
  const [visibleColumns, setVisibleColumns] = useState(
    () => new Set<ClientToggleableColumn>(readClientVisibleColumns()),
  );

  const handleVisibleColumnsChange = (columns: Set<ClientToggleableColumn>) => {
    setVisibleColumns(columns);
    writeClientVisibleColumns(columns);
  };

  const getClientOrders = (clientId: string) => clientOrderSummaries(orders, clientId);

  useEffect(() => {
    const clientId = searchParams.get("client")?.trim();
    if (!clientId) return;
    const next = new URLSearchParams(searchParams);
    next.delete("client");
    setSearchParams(next, { replace: true });
    const listed = clients.find((client) => client.id === clientId);
    if (listed) {
      setSelectedClient(listed);
      setDetailPanelOpen(true);
      return;
    }
    void getClient(workspaceId, clientId).then((client) => {
      if (!client) return;
      setSelectedClient(client);
      setDetailPanelOpen(true);
    });
  }, [clients, searchParams, setSearchParams, workspaceId]);

  function handleOpenHistoricalOrder(orderId: string) {
    const order = orders.find((item) => item.id === orderId);
    if (order) orderDetails.openOrder(order);
  }

  // Table columns — `name` and `actions` stay always visible; the rest follow Columns menu prefs.
  const allColumns: Column<Client>[] = [
    {
      key: "name",
      header: fieldLabels.label("clientName", t("clients.table.name")),
      cell: (client) => (
        <span className="block max-w-[12rem] truncate font-medium text-foreground xl:max-w-[14rem] 2xl:max-w-[16rem]" title={client.name}>
          <ClientNameWithMark clientId={client.id}>{client.name}</ClientNameWithMark>
        </span>
      ),
    },
    {
      key: "clientType",
      header: fieldLabels.label("clientType", t("clients.table.clientType")),
      cell: (client) => <ClientTypeBadge clientType={client.client_type} />,
    },

    {
      key: "contact",
      header: fieldLabels.label("phone", t("clients.table.contact")),
      cell: (client) => (
        <div className="max-w-[12rem] min-w-0 space-y-0.5 xl:max-w-[13rem] 2xl:max-w-[15rem]">
          {client.phone ? (
            <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
              <Phone aria-hidden="true" className="size-3 shrink-0 text-subtle-foreground" />
              <span className="truncate text-muted-foreground tabular-nums">{client.phone}</span>
            </div>
          ) : (
            <span className="text-subtle-foreground">—</span>
          )}
        </div>
      ),
      className: "hidden xl:table-cell",
    },
    {
      key: "orders",
      header: t("clients.table.orders"),
      cell: (client) => <span className="tabular-nums">{orderCountByClientId.get(client.id) ?? 0}</span>,
      className: "text-right",
    },
    {
      key: "balance",
      header: t("clients.table.balance"),
      cell: (client) => <span className={client.balance > 0 ? "font-medium text-success tabular-nums" : "text-foreground tabular-nums"}>{formatMoney(client.balance)}</span>,
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
      className: "w-[100px] text-right",
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
          {canMutateClients ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("clients.deleteClientLabel", { name: client.name })}
              onClick={(event) => {
                event.stopPropagation();
                setDeletingClient(client);
              }}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const columns = allColumns.filter((column) => {
    if (column.key === "name" || column.key === "actions") return true;
    return visibleColumns.has(column.key as ClientToggleableColumn);
  });

  // Stable identity: memoized client cards don't re-render when a dialog opens.
  const handleRowClick = useStableCallback((client: Client) => {
    setSelectedClient(client);
    setDetailPanelOpen(true);
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={clientCopy.title}
        description={isPending ? clientCopy.loading : industryClientTotalCount(workflow, totalClients)}
        actions={
          canMutateClients ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => mergeLauncher.current?.open()}>
                <Merge />
                {t("clients.merge.button")}
              </Button>
              <Button onClick={openAddClient}>
                <Plus />
                {clientCopy.addClient}
              </Button>
            </div>
          ) : undefined
        }
      />

      <SubscriptionReadOnlyNotice />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <SearchAndFilters
          className="min-w-0 flex-1"
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={clientCopy.searchPlaceholder}
          filters={[
            {
              key: "clientType",
              label: clientCopy.typeFilterLabel,
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
        {isMobile ? null : (
          <ClientColumnsMenu visibleColumns={visibleColumns} onVisibleColumnsChange={handleVisibleColumnsChange} />
        )}
      </div>

      <div ref={listTop.ref}>
      {isMobile ? (
        isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2 rounded-lg border border-border bg-card p-3 shadow-xs">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ))}
          </div>
        ) : clients.length === 0 ? (
          <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card shadow-xs">
            {clientsError ? (
              <ErrorState title={t("clients.errors.loadFailed")} description={clientsError.message} onRetry={() => refetchClients()} />
            ) : searchQuery || clientType !== "all" ? (
              <NoSearchResults query={searchQuery || (clientType === "organization" ? t("clients.filters.organizations") : t("clients.filters.individuals"))} />
            ) : (
              <NoClients onAddClient={openAddClient} />
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {clients.map((client) => (
              <ClientCard
                key={client.id}
                client={client}
                ordersCount={orderCountByClientId.get(client.id) ?? 0}
                formatMoney={formatMoney}
                onView={handleRowClick}
                onEdit={canMutateClients ? setEditingClient : undefined}
                onDelete={canMutateClients ? setDeletingClient : undefined}
              />
            ))}
          </div>
        )
      ) : (
        <DataTable
          columns={columns}
          data={clients}
          isLoading={isLoading}
          keyExtractor={(client) => client.id}
          onRowClick={handleRowClick}
          emptyState={
            clientsError ? (
              <ErrorState title={t("clients.errors.loadFailed")} description={clientsError.message} onRetry={() => refetchClients()} />
            ) : searchQuery || clientType !== "all" ? (
              <NoSearchResults query={searchQuery || (clientType === "organization" ? t("clients.filters.organizations") : t("clients.filters.individuals"))} />
            ) : (
              <NoClients onAddClient={openAddClient} />
            )
          }
        />
      )}

      </div>

      {!isLoading && totalClients > 0 ? (
        <ServerListPager
          page={resolvedPage}
          pageCount={clientsPage?.pageCount ?? 1}
          pageSize={pageSize}
          total={totalClients}
          onPageChange={(next) => {
            setPage(next);
            listTop.scrollToListTop();
          }}
          onPageSizeChange={(size) => {
            setPageSize(size);
            listTop.scrollToListTop();
          }}
        />
      ) : null}

      <DialogLauncher ref={addClientLauncher}>
        {({ open, setOpen }) => <AddClientDialog open={open} onOpenChange={setOpen} />}
      </DialogLauncher>

      <CreateOrderDialog
        open={Boolean(orderForClient)}
        onOpenChange={(open) => {
          if (!open) {
            setOrderForClient(null);
            setOrderForVehicleId(null);
            setCreateKind("order");
          }
        }}
        initialClient={orderForClient ? { id: orderForClient.id, name: orderForClient.name } : null}
        initialVehicleId={orderForVehicleId}
        kind={createKind}
        // Order created from the client card (client or one of its vehicles) → close that card too.
        onCreated={() => setDetailPanelOpen(false)}
      />

      <Dialog
        open={Boolean(editingClient)}
        onOpenChange={(open) => {
          if (!open) setEditingClient(null);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{clientCopy.editDialogTitle}</DialogTitle>
            <DialogDescription className="sr-only">{clientCopy.editDialogDescription}</DialogDescription>
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

      <ClientDetailPanel
        selectedClient={selectedClient}
        setDetailPanelOpen={setDetailPanelOpen}
        detailPanelOpen={detailPanelOpen}
        getClientOrders={getClientOrders}
        workspaceOrders={orders}
        onClientUpdated={setSelectedClient}
        onClientDeleted={(clientId) => {
          setSelectedClient((current) => (current?.id === clientId ? null : current));
          setEditingClient((current) => (current?.id === clientId ? null : current));
        }}
        ordersLoading={ordersLoading}
        ordersError={Boolean(ordersError)}
        onOpenOrder={handleOpenHistoricalOrder}
        onCreateOrder={
          canMutateClients
            ? (client, vehicleId) => {
                setCreateKind("order");
                setOrderForClient(client);
                setOrderForVehicleId(vehicleId ?? null);
              }
            : undefined
        }
        onCreateEstimate={
          canMutateClients
            ? (client, vehicleId) => {
                setCreateKind("estimate");
                setOrderForClient(client);
                setOrderForVehicleId(vehicleId ?? null);
              }
            : undefined
        }
      />

      <DeleteClientDialog
        client={deletingClient}
        onClose={() => setDeletingClient(null)}
        onDeleted={(clientId) => {
          setSelectedClient((current) => (current?.id === clientId ? null : current));
          setEditingClient((current) => (current?.id === clientId ? null : current));
          setDetailPanelOpen(false);
        }}
      />

      <DialogLauncher ref={mergeLauncher}>
        {({ open, setOpen }) => (
          <MergeClientsDialog
            open={open}
            onClose={() => setOpen(false)}
            clients={clients}
            orderCountByClientId={orderCountByClientId}
            onMerged={(client) => {
              setSelectedClient(client);
              setDetailPanelOpen(true);
            }}
          />
        )}
      </DialogLauncher>

      <OrderDetailPanel
        {...orderDetails.panelProps}
        onOpenClient={(clientId) => {
          orderDetails.panelProps.setDetailPanelOpen(false);
          const existing = clients.find((client) => client.id === clientId);
          if (existing) {
            setSelectedClient(existing);
            setDetailPanelOpen(true);
            return;
          }
          void getClient(workspaceId, clientId).then((client) => {
            if (!client) return;
            setSelectedClient(client);
            setDetailPanelOpen(true);
          });
        }}
      />
    </div>
  );
}
