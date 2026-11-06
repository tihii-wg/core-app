import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Loader2, Printer } from "lucide-react";
import { Button } from "../../ui/Button";
import type { Invoice, InvoiceDocument } from "../../lib/types";
import { getInvoice } from "../../services/apiInvoices";
import { useGetDocumentTemplates } from "../documents/useGetDocumentTemplates";
import { usePrintInvoiceDocument } from "../documents/usePrintInvoiceDocument";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useInvoiceDocumentData } from "./useInvoiceDocumentData";
import { InvoicePrintRoot, type InvoicePrintJob } from "./InvoicePrintRoot";

/**
 * Quick-print for one invoice row. Uses a workspace invoice template when present
 * (default preferred); otherwise keeps the fixed InvoicePrintRoot output.
 */
export function InvoicePrintButton({ invoice, triggerClassName }: { invoice: Invoice; triggerClassName?: string }) {
  const { t } = useTranslation();
  const [legacyActive, setLegacyActive] = useState(false);
  const { data: templates = [] } = useGetDocumentTemplates();
  const printInvoice = usePrintInvoiceDocument();

  const preferredTemplate = useMemo(() => {
    const invoiceTemplates = templates
      .filter(
        (template) =>
          template.isActive &&
          template.documentType === "invoice" &&
          (Boolean(template.layout) || Boolean(template.bodyHtml.trim())),
      )
      .slice()
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
    return invoiceTemplates[0] ?? null;
  }, [templates]);

  const documentQuery = useQuery({
    queryKey: ["invoice-row-print", invoice.workspaceId, invoice.id],
    queryFn: () => getInvoice(invoice.id, invoice.workspaceId),
    enabled: legacyActive,
    retry: false,
  });

  useEffect(() => {
    if (!legacyActive || !documentQuery.error) return;
    toast.error(documentQuery.error instanceof Error ? documentQuery.error.message : t("invoices.detail.loadErrorTitle"), {
      id: `invoice-print-${invoice.id}`,
    });
    setLegacyActive(false);
  }, [legacyActive, documentQuery.error, invoice.id, t]);

  const busy = legacyActive || printInvoice.isPending;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={triggerClassName}
        disabled={busy}
        aria-label={t("invoices.actions.print")}
        title={t("invoices.actions.print")}
        onClick={(event) => {
          event.stopPropagation();
          if (busy) return;
          if (preferredTemplate) {
            printInvoice.mutate({ invoiceId: invoice.id, templateId: preferredTemplate.id });
            return;
          }
          setLegacyActive(true);
        }}
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Printer aria-hidden="true" />}
      </Button>
      {legacyActive && documentQuery.data ? (
        <InvoiceRowPrintJob invoice={documentQuery.data} onDone={() => setLegacyActive(false)} />
      ) : null}
    </>
  );
}

function InvoiceRowPrintJob({ invoice, onDone }: { invoice: InvoiceDocument; onDone: () => void }) {
  const { formatMoney } = useWorkspaceMoney();
  const documentData = useInvoiceDocumentData(invoice);
  const [job, setJob] = useState<InvoicePrintJob | null>(null);

  useEffect(() => {
    if (documentData.isLoading || job) return;
    setJob({
      invoice,
      sections: documentData.sections,
      companyName: documentData.companyName,
      logoUrl: documentData.logoUrl,
      supplier: documentData.supplier,
      formatMoney,
      documentTitle: `${invoice.invoiceNumber}.pdf`,
    });
  }, [documentData, formatMoney, invoice, job]);

  if (!job) return null;
  return <InvoicePrintRoot job={job} onDone={onDone} />;
}
