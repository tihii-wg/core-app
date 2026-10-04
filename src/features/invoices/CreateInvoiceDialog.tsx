import { useState } from "react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import type { Order } from "../../lib/types";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useCreateInvoice } from "./useCreateInvoice";

type CreateInvoiceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Orders that can still be invoiced: not cancelled, with service lines and no invoice yet. */
  orders: Order[];
};

export function CreateInvoiceDialog({ open, onOpenChange, orders }: CreateInvoiceDialogProps) {
  const [orderId, setOrderId] = useState("");
  const createInvoice = useCreateInvoice();
  const { formatMoney } = useWorkspaceMoney();
  const selectedOrder = orders.find((order) => order.id === orderId);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setOrderId("");
    onOpenChange(nextOpen);
  };

  const handleCreate = () => {
    if (!selectedOrder || createInvoice.isPending) return;
    createInvoice.mutate(selectedOrder.id, { onSuccess: () => handleOpenChange(false) });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Invoice</DialogTitle>
          <DialogDescription>The invoice copies the order's client, details and services as they are now.</DialogDescription>
        </DialogHeader>

        {orders.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Every order with services already has an invoice.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invoice-order">Order *</Label>
              <Select value={orderId} onValueChange={setOrderId}>
                <SelectTrigger id="invoice-order" className="w-full">
                  <SelectValue placeholder="Select an order" />
                </SelectTrigger>
                <SelectContent>
                  {orders.map((order) => (
                    <SelectItem key={order.id} value={order.id}>
                      {order.orderNumber} · {order.clientName} ({formatMoney(order.totalPrice)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedOrder && (
              <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium [overflow-wrap:anywhere] text-foreground">{selectedOrder.clientName}</p>
                    <p className="mt-0.5 text-muted-foreground [overflow-wrap:anywhere]">{selectedOrder.device}</p>
                  </div>
                  <p className="shrink-0 font-semibold text-foreground tabular-nums">{formatMoney(selectedOrder.totalPrice)}</p>
                </div>
                <ul className="mt-3 space-y-1 border-t border-border pt-3 text-muted-foreground">
                  {selectedOrder.services.map((line, index) => (
                    <li key={line.id ?? index} className="flex justify-between gap-4">
                      <span className="truncate">
                        {line.serviceName}
                        {line.quantity > 1 && ` × ${line.quantity}`}
                      </span>
                      <span className="tabular-nums">{formatMoney(line.price * line.quantity)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={createInvoice.isPending}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!selectedOrder} loading={createInvoice.isPending}>
            Create Invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
