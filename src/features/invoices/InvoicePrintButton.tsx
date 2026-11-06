import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Loader2, Printer } from "lucide-react";
import { Button } from "../../ui/Button";
import type { Invoice, InvoiceDocument } from "../../lib/types";
import { getInvoice } from "../../services/apiInvoices";
import { printInvoiceDocument } from "../../services/apiDocumentTemplates";
import { useGetDocumentTemplates } from "../documents/useGetDocumentTemplates";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useInvoiceDocumentData } from "./useInvoiceDocumentData";
import { InvoicePrintRoot, type InvoicePrintJob } from "./InvoicePrintRoot";

/**
 * Quick-print for one invoice row. Prefers the workspace invoice template (default first).
 * Falls back to InvoicePrintRoot when templates are missing or layout rendering fails.
 */
export function InvoicePrintButton({ invoice, triggerClassName }: { invoice: Invoice; triggerClassName?: string }) {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const [legacyActive, setLegacyActive] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const { data: templates = [] } = useGetDocumentTemplates();

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

  const busy = legacyActive || templateBusy;

  async function printWithTemplate(templateId: string) {
    setTemplateBusy(true);
    try {
      const result = await printInvoiceDocument(invoice.id, templateId, workspaceId ?? invoice.workspaceId);
      if (result === "unavailable") {
        setLegacyActive(true);
        return;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
      setLegacyActive(true);
    } finally {
      setTemplateBusy(false);
    }
  }

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
            void printWithTemplate(preferredTemplate.id);
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
