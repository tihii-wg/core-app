import { useState } from "react";
import { Mail, MapPin, Pencil, Phone } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import type { Client } from "../../lib/types";

export type ClientOrderSummary = {
  id: string;
  orderNumber: string;
  device: string;
  service: string;
  totalPrice: number;
};
import EditClientForm from "./EditClientForm";

type ClientDetailPanelProps = {
  selectedClient: Client | null;
  detailPanelOpen: boolean;
  setDetailPanelOpen: (open: boolean) => void;
  onClientUpdated: (client: Client) => void;
  getClientOrders: (clientId: string) => ClientOrderSummary[];
};

export default function ClientDetailPanel({ selectedClient, detailPanelOpen, setDetailPanelOpen, onClientUpdated, getClientOrders }: ClientDetailPanelProps) {
  
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
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="pr-12">{selectedClient?.name}</SheetTitle>
          {selectedClient && !isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              aria-label="Edit"
              className="ring-offset-background focus:ring-ring absolute top-4 right-10 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden"
            >
              <Pencil className="size-4" />
            </button>
          )}
          <SheetDescription className="sr-only">View and edit this client's contact information, balance, and order history.</SheetDescription>
        </SheetHeader>

        {selectedClient && isEditing && (
          <div className="mx-4 mt-2">
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
          <div className="mt-6 space-y-6 mx-4">
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
                if (clientOrders?.length === 0) {
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
              <p>Client since: {selectedClient.created_at?.split("T")[0]}</p>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
