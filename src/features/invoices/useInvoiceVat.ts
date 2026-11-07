import { useQuery } from "@tanstack/react-query";
import { getInvoiceTaxTotal } from "../../services/apiInvoiceTax";
import { getOrder } from "../../services/apiOrders";
import { invoiceVatBreakdown, type OrderVatBreakdown } from "../finance/orderVat";
import { useWorkspaceVatRate } from "../finance/useWorkspaceVatRate";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

/**
 * VAT-inclusive breakdown for an invoice:
 * prefers stored `tax_total`, else extracts using the linked order's vat_rate,
 * else the current workspace rate.
 */
export function useInvoiceVat(
  invoiceId: string | undefined,
  total: number | undefined,
  orderId?: string | null,
): OrderVatBreakdown | null {
  const { workspaceId } = useActiveWorkspaceId();
  const { rate: workspaceVatRate } = useWorkspaceVatRate();
  const { data: taxTotal } = useQuery({
    queryKey: ["invoice-tax-total", workspaceId, invoiceId],
    queryFn: () => getInvoiceTaxTotal(invoiceId ?? "", workspaceId),
    enabled: Boolean(workspaceId && invoiceId),
    retry: false,
  });
  const { data: orderVatRate } = useQuery({
    queryKey: ["invoice-order-vat-rate", workspaceId, orderId],
    queryFn: async () => {
      if (!orderId || !workspaceId) return null;
      const order = await getOrder(orderId, workspaceId);
      return order.vatRate ?? null;
    },
    enabled: Boolean(workspaceId && orderId),
    staleTime: 60_000,
    retry: false,
  });
  if (total == null) return null;
  return invoiceVatBreakdown({
    total,
    taxTotal: taxTotal ?? null,
    vatRate: orderVatRate ?? workspaceVatRate,
  });
}
