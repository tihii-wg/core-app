import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InvoiceDocument } from "../../lib/types";
import { getOrder } from "../../services/apiOrders";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useWorkspaceAvatar } from "../workspaces/useWorkspaceAvatar";
import { useLegalEntities } from "../settings/useLegalEntities";
import { classifyInvoiceItems, type InvoiceOrderLines, type InvoiceSections } from "./invoiceItemSections";
import type { InvoiceSupplierInfo } from "./InvoicePrintDocument";

export type InvoiceDocumentData = {
  isLoading: boolean;
  companyName: string;
  logoUrl: string | null;
  supplier: InvoiceSupplierInfo;
  sections: InvoiceSections;
};

/**
 * Assembles everything the printable invoice needs from persisted
 * data: workspace company settings, the workspace's default legal
 * entity (never another workspace's, never a fabricated one), the
 * company logo, and works/materials sections classified from the
 * invoice items plus the source order lines.
 */
export function useInvoiceDocumentData(invoice: InvoiceDocument | null): InvoiceDocumentData {
  const workspaceId = invoice?.workspaceId;
  const { data: workspace } = useGetWorkspace(workspaceId);
  const { data: entities = [] } = useLegalEntities(workspaceId);
  // The real company logo from Supabase Storage, resolved through the
  // same signed-URL query the rest of the app uses (cached, shared).
  const { data: signedLogoUrl, isPending: logoPending } = useWorkspaceAvatar(workspaceId, workspace?.avatarPath);
  const logoUrl = signedLogoUrl ?? null;

  const orderId = invoice?.orderId;
  const { data: orderLines } = useQuery<InvoiceOrderLines | null>({
    queryKey: ["invoice-document-order", workspaceId, orderId],
    enabled: Boolean(workspaceId && orderId),
    retry: false,
    queryFn: async () => {
      try {
        const order = await getOrder(orderId as string, workspaceId);
        return {
          services: (order.services ?? []).map((line) => ({
            serviceId: line.serviceId || null,
            serviceName: line.serviceName,
            price: line.price,
            quantity: line.quantity,
          })),
          materials: (order.materials ?? []).map((line) => ({
            itemName: line.itemName,
            price: line.price,
            quantity: line.quantity,
          })),
        };
      } catch {
        // Source order unavailable (deleted / no access): the
        // classifier falls back to the service_id marker alone.
        return null;
      }
    },
  });

  const sections = useMemo(
    () => classifyInvoiceItems(invoice?.items ?? [], orderLines ?? null),
    [invoice?.items, orderLines],
  );

  const supplier = useMemo<InvoiceSupplierInfo>(() => {
    // Canonical default first (workspaces.default_legal_entity_id),
    // then the synchronized is_default flag. No other substitution.
    const entity =
      entities.find((entry) => entry.id === workspace?.defaultLegalEntityId) ??
      entities.find((entry) => entry.isDefault) ??
      null;
    if (entity) {
      return {
        name: entity.legalName,
        address: entity.address ?? "",
        registrationNumber: entity.registrationNumber ?? "",
        taxNumber: entity.taxNumber ?? "",
        email: entity.billingEmail ?? "",
        iban: entity.iban ?? "",
        bankName: entity.bankName ?? "",
        bankCode: entity.bankCode ?? "",
        extraInfo: entity.additionalInfo ?? "",
      };
    }
    return {
      name: workspace?.name ?? "",
      address: workspace?.companyAddress ?? "",
      registrationNumber: workspace?.registrationNumber ?? "",
      taxNumber: workspace?.taxVatNumber ?? "",
      email: workspace?.billingEmail ?? "",
      iban: workspace?.iban ?? "",
      bankName: workspace?.bankName ?? "",
      bankCode: workspace?.bankCode ?? "",
      extraInfo: workspace?.printExtraInfo ?? "",
    };
  }, [entities, workspace]);

  return {
    // While a stored logo is still being signed, printing waits:
    // the document must never be produced with the logo unresolved.
    isLoading: Boolean(invoice) && (!workspace || (Boolean(workspace?.avatarPath) && logoPending)),
    companyName: workspace?.name ?? "",
    logoUrl,
    supplier,
    sections,
  };
}
