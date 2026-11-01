import { useQuery } from "@tanstack/react-query";
import { getInvoiceTaxTotal } from "../../services/apiInvoiceTax";
import { pickDefaultIncludedTax } from "../../services/apiTaxes";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetTaxes } from "../taxes/useTaxes";
import { resolveInvoiceVat } from "./invoiceVat";

/** VAT line for an invoice: stored `tax_total` when present, else an estimate from the active tax-included rate. */
export function useInvoiceVat(invoiceId: string | undefined, total: number | undefined) {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: taxes } = useGetTaxes();
  const { data: taxTotal } = useQuery({
    queryKey: ["invoice-tax-total", workspaceId, invoiceId],
    queryFn: () => getInvoiceTaxTotal(invoiceId ?? "", workspaceId),
    enabled: Boolean(workspaceId && invoiceId),
    retry: false,
  });
  if (total == null) return null;
  const defaultTax = pickDefaultIncludedTax(taxes?.taxes ?? []);
  return resolveInvoiceVat(total, taxTotal ?? null, defaultTax?.rate ?? null);
}
