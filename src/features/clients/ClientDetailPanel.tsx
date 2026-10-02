import { useState } from "react";
import { Mail, MapPin, Pencil, Phone } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import ClientTypeBadge from "./ClientTypeBadge";
import type { Client } from "../../lib/types";

export type ClientOrderSummary = {
  id: string;
  orderNumber: string;
  device: string;
  service: string;
  totalPrice: number;
};
import EditClientForm from "./EditClientForm";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";

type ClientDetailPanelProps = {
  selectedClient: Client | null;
  detailPanelOpen: boolean;
  setDetailPanelOpen: (open: boolean) => void;
  onClientUpdated: (client: Client) => void;
  getClientOrders: (clientId: string) => ClientOrderSummary[];
};

export default function ClientDetailPanel({ selectedClient, detailPanelOpen, setDetailPanelOpen, onClientUpdated, getClientOrders }: ClientDetailPanelProps) {
  
  const { formatMoney } = useWorkspaceMoney();
  const [isEditing, setIsEditing] = useState(false);
  const [editingClientId, setEditingClientId] = useState(selectedClient?.id);

  if (selectedClient?.id !== editingClientId) {
    setEditingClientId(selectedClient?.id);
    setIsEditing(false);
  }

  function handleOpenChange(open: boolean) {
    setDetailPanelOpen(open);
    if (!open) setIsEditing(false);
  }

  return (
    <Sheet open={detailPanelOpen} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pr-24">
          <SheetTitle>
            <span className="inline-flex min-w-0 flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
              {selectedClient?.name}
              {selectedClient && <ClientTypeBadge clientType={selectedClient.client_type} />}
            </span>
          </SheetTitle>
          {selectedClient && !isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              aria-label="Edit"
              title="Edit client"
              className="absolute top-3.5 right-12 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35"
            >
              <Pencil className="size-4" />
            </button>
          )}
          <SheetDescription className="sr-only">View and edit this client's contact information, balance, and order history.</SheetDescription>
        </SheetHeader>

        {selectedClient && isEditing && (
          <div className="px-5 py-5">
            <EditClientForm
              key={selectedClient.id}
              client={selectedClient}
              onCancel={() => setIsEditing(false)}
              onUpdated={(client) => {
                onClientUpdated(client);
                setIsEditing(false);
                setDetailPanelOpen(false);
              }}
            />
          </div>
        )}

        {selectedClient && !isEditing && (
          <div className="space-y-6 px-5 py-5">
            {/* Contact Info */}
            <div className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">Contact Information</h3>
              <div className="space-y-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <Mail className="size-4 shrink-0 text-subtle-foreground" />
                  <a href={`mailto:${selectedClient.email}`} className="truncate text-primary hover:underline">
                    {selectedClient.email}
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="size-4 shrink-0 text-subtle-foreground" />
                  <a href={`tel:${selectedClient.phone}`} className="text-foreground tabular-nums">
                    {selectedClient.phone}
                  </a>
                </div>
                {selectedClient.client_type === "organization" && selectedClient.contact_person && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Contact</span>
                    <span className="text-foreground">{selectedClient.contact_person}</span>
                  </div>
                )}
                {selectedClient.client_type === "organization" && selectedClient.tax_id && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Tax ID / IDNO</span>
                    <span className="text-foreground">{selectedClient.tax_id}</span>
                  </div>
                )}
                {selectedClient.address && (
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
                    <span className="[overflow-wrap:anywhere] text-foreground">{selectedClient.address}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Balance */}
            <div className="rounded-lg border border-border bg-muted/50 p-4">
              <p className="text-xs font-medium text-muted-foreground">Current Balance</p>
              <p className={`mt-1 truncate text-2xl font-semibold tracking-tight tabular-nums ${selectedClient.balance > 0 ? "text-destructive" : "text-foreground"}`}>{formatMoney(selectedClient.balance)}</p>
            </div>

            {/* Order History */}
            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">Order History</h3>
              {(() => {
                const clientOrders = getClientOrders(selectedClient.id);
                if (clientOrders?.length === 0) {
                  return <p className="text-sm text-muted-foreground py-4 text-center">No orders yet</p>;
                }
                return (
                  <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                    {clientOrders.slice(0, 5).map((order) => (
                      <div key={order.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground tabular-nums">{order.orderNumber}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {order.device} - {order.service}
                          </p>
                        </div>
                        <p className="shrink-0 text-sm font-medium text-foreground tabular-nums">{formatMoney(order.totalPrice)}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
            {/* Notes */}
            {selectedClient.notes && (
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">Notes</h3>
                <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere] text-foreground">{selectedClient.notes}</p>
              </div>
            )}

            {/* Timestamps */}
            <div className="text-xs text-muted-foreground">
              <p>Client since: {selectedClient.created_at?.split("T")[0]}</p>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
