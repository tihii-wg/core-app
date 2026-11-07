import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Printer, Pencil } from "lucide-react";
import { Button } from "../../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/Dialog";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import type { DocumentTemplate } from "../../services/apiDocumentTemplates";
import { printHtmlDocument, renderTemplateDocument } from "../../services/apiDocumentTemplates";
import {
  buildInvoicePrintContext,
  buildOrderPrintContext,
  listRecentInvoicesForPrintPreview,
  listRecentOrdersForPrintPreview,
} from "../../services/printContext";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import type { DocumentStyle } from "./documentStyle";
import { DEMO_PRINT_SOURCE_ID, demoPrintContext } from "./demoPrintContext";
import { isDemoPrintSource } from "./templatePreviewHtml";
import type { PrintContext, PrintDocumentKind } from "./templateVariables";

export type TemplatePreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: DocumentTemplate | null;
  documentStyle?: DocumentStyle | null;
  locale: string;
  currency: string;
  vatRate?: number | null;
  logoUrl?: string | null;
  companyName?: string | null;
  onOpenDesigner?: (template: DocumentTemplate) => void;
};

function asDocumentKind(documentType: string): PrintDocumentKind {
  if (documentType === "act" || documentType === "invoice") return documentType;
  return "work_order";
}

export function TemplatePreviewDialog({
  open,
  onOpenChange,
  template,
  documentStyle = null,
  locale,
  currency,
  vatRate,
  logoUrl,
  companyName,
  onOpenDesigner,
}: TemplatePreviewDialogProps) {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const [sourceId, setSourceId] = useState(DEMO_PRINT_SOURCE_ID);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isInvoice = template?.documentType === "invoice";

  const recentOrdersQuery = useQuery({
    queryKey: ["print-builder-preview-orders", workspaceId],
    queryFn: () => listRecentOrdersForPrintPreview(workspaceId, 20),
    enabled: open && Boolean(workspaceId) && !isInvoice,
    staleTime: 30_000,
  });
  const recentInvoicesQuery = useQuery({
    queryKey: ["print-builder-preview-invoices", workspaceId],
    queryFn: () => listRecentInvoicesForPrintPreview(workspaceId, 20),
    enabled: open && Boolean(workspaceId) && isInvoice,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (open) setSourceId(DEMO_PRINT_SOURCE_ID);
  }, [open, template?.id]);

  useEffect(() => {
    if (!open || !template) {
      setHtml(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        let ctx: PrintContext;
        if (isDemoPrintSource(sourceId)) {
          ctx = demoPrintContext({
            documentType: asDocumentKind(template.documentType),
            locale,
            currency,
            vatRate,
            logoUrl,
            companyName,
          });
        } else if (isInvoice) {
          ctx = await buildInvoicePrintContext(sourceId, workspaceId);
        } else {
          ctx = await buildOrderPrintContext(sourceId, workspaceId, asDocumentKind(template.documentType));
        }
        if (cancelled) return;
        const documentHtml = renderTemplateDocument(template, ctx, documentStyle);
        if (!cancelled) {
          setHtml(documentHtml);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setHtml(null);
          setLoading(false);
          setError(err instanceof Error ? err.message : t("common.somethingWentWrong"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    template,
    sourceId,
    workspaceId,
    isInvoice,
    locale,
    currency,
    vatRate,
    logoUrl,
    companyName,
    documentStyle,
    t,
  ]);

  const sourceOptions = useMemo(() => {
    if (isInvoice) return recentInvoicesQuery.data ?? [];
    return recentOrdersQuery.data ?? [];
  }, [isInvoice, recentInvoicesQuery.data, recentOrdersQuery.data]);

  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[min(100vw-1rem,56rem)] max-w-[min(100vw-1rem,56rem)] flex-col gap-3 overflow-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{t("settings.printTemplates.previewTitle", { name: template.name })}</DialogTitle>
          <DialogDescription className="sr-only">{t("settings.printTemplates.preview")}</DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1.5 sm:max-w-sm sm:flex-1">
            <Label htmlFor="template-preview-source">{t("settings.printTemplates.previewSource")}</Label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger id="template-preview-source" className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEMO_PRINT_SOURCE_ID}>{t("settings.printTemplates.demoData")}</SelectItem>
                {sourceOptions.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {"orderNumber" in item
                      ? `${item.orderNumber || item.id.slice(0, 8)} · ${item.clientName || "—"}`
                      : `${item.invoiceNumber || item.id.slice(0, 8)} · ${item.clientName || "—"}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-md border border-border bg-muted/30">
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : error ? (
            <p className="p-4 text-sm text-destructive">{error}</p>
          ) : html ? (
            <iframe
              title={t("settings.printTemplates.previewTitle", { name: template.name })}
              sandbox=""
              srcDoc={html}
              className="block h-[min(70vh,900px)] w-full min-w-0 border-0 bg-white"
            />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("settings.printTemplates.noBody")}</p>
          )}
        </div>

        <DialogFooter className="flex flex-wrap gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!html}
              onClick={() => {
                if (html) printHtmlDocument(html);
              }}
            >
              <Printer />
              {t("settings.printTemplates.print")}
            </Button>
            {onOpenDesigner ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  onOpenDesigner(template);
                }}
              >
                <Pencil />
                {t("settings.printTemplates.openInDesigner")}
              </Button>
            ) : null}
          </div>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
