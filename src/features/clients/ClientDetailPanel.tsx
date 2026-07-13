import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { Mail, MapPin, Phone } from "lucide-react";

export default function ClientDetailPanel({ selectedClient, detailPanelOpen, setDetailPanelOpen ,getClientOrders}) {
  return (
    <Sheet open={detailPanelOpen} onOpenChange={setDetailPanelOpen}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{selectedClient?.name}</SheetTitle>
        </SheetHeader>

        {selectedClient && (
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
              <p>Client since: {selectedClient.created_at.split("T")[0]}</p>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
