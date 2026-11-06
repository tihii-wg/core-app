/**
 * Editor for the workspace DocumentStyle (colors, fonts, shared header/footer).
 * Header/footer reuse the layout block model; preview switches Invoice / Act / Work order.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Switch } from "../../ui/Switch";
import {
  documentStyleToRenderStyle,
  resolvePrintPageCss,
  saveDocumentStyle,
  type DocumentTemplate,
} from "../../services/apiDocumentTemplates";
import {
  buildInvoicePrintContext,
  buildOrderPrintContext,
  listRecentInvoicesForPrintPreview,
  listRecentOrdersForPrintPreview,
} from "../../services/printContext";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import {
  defaultDocumentStyle,
  fontFamilyCss,
  type DocumentStyle,
  type DocumentStyleFontFamily,
} from "./documentStyle";
import { defaultLayoutForType } from "./defaultLayouts";
import { renderLayoutToHtml, type DocumentTemplateType } from "./layout";
import { buildPrintDocument } from "./printTemplate";
import { DocumentTemplateBuilder } from "./DocumentTemplateBuilder";

type DocumentStyleEditorProps = {
  template: DocumentTemplate;
  canEdit: boolean;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

type PreviewKind = DocumentTemplateType;
type StyleTab = "appearance" | "header" | "footer";

function cloneStyle(style: DocumentStyle): DocumentStyle {
  return structuredClone(style);
}

function stylesEqual(a: DocumentStyle, b: DocumentStyle) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function DocumentStyleEditor({ template, canEdit, onClose, onDirtyChange }: DocumentStyleEditorProps) {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const initial = useMemo(() => cloneStyle(template.style ?? defaultDocumentStyle()), [template.style]);
  const [style, setStyle] = useState<DocumentStyle>(initial);
  const [name, setName] = useState(template.name);
  const [tab, setTab] = useState<StyleTab>("appearance");
  const [previewKind, setPreviewKind] = useState<PreviewKind>("invoice");
  const [previewEntityId, setPreviewEntityId] = useState("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [editingShared, setEditingShared] = useState(false);

  const dirty = !stylesEqual(style, initial) || name !== template.name;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const recentOrdersQuery = useQuery({
    queryKey: ["print-style-preview-orders", workspaceId],
    queryFn: () => listRecentOrdersForPrintPreview(workspaceId, 20),
    enabled: Boolean(workspaceId) && previewKind !== "invoice",
    staleTime: 30_000,
  });
  const recentInvoicesQuery = useQuery({
    queryKey: ["print-style-preview-invoices", workspaceId],
    queryFn: () => listRecentInvoicesForPrintPreview(workspaceId, 20),
    enabled: Boolean(workspaceId) && previewKind === "invoice",
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!previewEntityId) {
      setPreviewHtml(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const ctx =
            previewKind === "invoice"
              ? await buildInvoicePrintContext(previewEntityId, workspaceId)
              : await buildOrderPrintContext(previewEntityId, workspaceId, previewKind);
          if (cancelled) return;
          const layout = defaultLayoutForType(previewKind);
          const body = renderLayoutToHtml(layout, ctx, {
            style: documentStyleToRenderStyle(style),
          });
          setPreviewHtml(buildPrintDocument(body, name || template.name, resolvePrintPageCss(layout, style)));
        } catch {
          if (!cancelled) setPreviewHtml(null);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [style, previewEntityId, workspaceId, previewKind, name, template.name]);

  const save = useMutation({
    mutationFn: async () => {
      await saveDocumentStyle(template.id, style, workspaceId, name);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["document-templates", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["document-style", workspaceId] });
      toast.success(t("settings.printTemplates.toast.saved"));
      onClose();
    },
    onError: (error: Error) => toast.error(error.message || t("common.somethingWentWrong")),
  });

  const headerTemplate: DocumentTemplate = useMemo(
    () => ({
      ...template,
      documentType: "work_order",
      name: t("settings.printTemplates.sharedHeader"),
      layout: {
        version: 2,
        page: { size: style.page.size, orientation: style.page.orientation, marginsMm: style.page.marginsMm, fontSizePt: style.font.baseSizePt },
        useStyle: false,
        blocks: style.sharedHeader,
      },
      style: null,
    }),
    [template, style, t],
  );

  const footerTemplate: DocumentTemplate = useMemo(
    () => ({
      ...template,
      documentType: "work_order",
      name: t("settings.printTemplates.sharedFooter"),
      layout: {
        version: 2,
        page: { size: style.page.size, orientation: style.page.orientation, marginsMm: style.page.marginsMm, fontSizePt: style.font.baseSizePt },
        useStyle: false,
        blocks: style.sharedFooter,
      },
      style: null,
    }),
    [template, style, t],
  );

  if (editingShared && (tab === "header" || tab === "footer")) {
    const sharedTemplate = tab === "header" ? headerTemplate : footerTemplate;
    return (
      <DocumentTemplateBuilder
        template={sharedTemplate}
        canEdit={canEdit}
        onClose={() => setEditingShared(false)}
        onDirtyChange={onDirtyChange}
        onSaveLayout={(layout) => {
          setStyle((prev) => ({
            ...prev,
            ...(tab === "header" ? { sharedHeader: layout.blocks } : { sharedFooter: layout.blocks }),
          }));
          setEditingShared(false);
          return Promise.resolve();
        }}
      />
    );
  }

  const entities =
    previewKind === "invoice" ? (recentInvoicesQuery.data ?? []) : (recentOrdersQuery.data ?? []);

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="style-name">{t("settings.printTemplates.name")}</Label>
          <Input
            id="style-name"
            value={name}
            disabled={!canEdit}
            onChange={(event) => setName(event.target.value)}
            className="h-8 w-64"
          />
        </div>
        <div className="flex gap-2">
          {(["appearance", "header", "footer"] as const).map((key) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={tab === key ? "default" : "outline"}
              onClick={() => setTab(key)}
            >
              {key === "appearance"
                ? t("settings.printTemplates.themeColors")
                : key === "header"
                  ? t("settings.printTemplates.sharedHeader")
                  : t("settings.printTemplates.sharedFooter")}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canEdit || save.isPending || !dirty}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            <Save />
            {t("settings.printTemplates.save")}
          </Button>
        </div>
      </div>

      {tab === "appearance" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <fieldset className="space-y-2 rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-semibold">{t("settings.printTemplates.themeColors")}</legend>
            {(
              [
                ["primary", t("settings.printTemplates.colorPrimary")],
                ["primaryDark", t("settings.printTemplates.colorPrimaryDark")],
                ["tint", t("settings.printTemplates.colorTint")],
                ["muted", t("settings.printTemplates.colorMuted")],
                ["text", t("settings.printTemplates.colorText")],
                ["border", t("settings.printTemplates.colorBorder")],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex items-center gap-2">
                <Label className="w-28 text-xs" htmlFor={`color-${key}`}>
                  {label}
                </Label>
                <Input
                  id={`color-${key}`}
                  type="color"
                  className="h-8 w-14 p-1"
                  disabled={!canEdit}
                  value={style.colors[key]}
                  onChange={(event) =>
                    setStyle((prev) => ({
                      ...prev,
                      colors: { ...prev.colors, [key]: event.target.value },
                    }))
                  }
                />
                <Input
                  className="h-8 flex-1 font-mono text-xs"
                  disabled={!canEdit}
                  value={style.colors[key]}
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) return;
                    setStyle((prev) => ({ ...prev, colors: { ...prev.colors, [key]: value } }));
                  }}
                />
              </div>
            ))}
          </fieldset>

          <div className="space-y-3">
            <fieldset className="space-y-2 rounded-md border border-border p-3">
              <legend className="px-1 text-xs font-semibold">{t("settings.printTemplates.page")}</legend>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">{t("settings.printTemplates.pageSize")}</Label>
                  <Select
                    value={style.page.size}
                    disabled={!canEdit}
                    onValueChange={(value) =>
                      setStyle((prev) => ({
                        ...prev,
                        page: { ...prev.page, size: value === "A5" ? "A5" : "A4" },
                      }))
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A4">A4</SelectItem>
                      <SelectItem value="A5">A5</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">{t("settings.printTemplates.marginsMm")}</Label>
                  <Input
                    type="number"
                    className="h-8"
                    disabled={!canEdit}
                    value={style.page.marginsMm}
                    onChange={(event) =>
                      setStyle((prev) => ({
                        ...prev,
                        page: { ...prev.page, marginsMm: Number(event.target.value) || 10 },
                      }))
                    }
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">{t("settings.printTemplates.fontSizePt")}</Label>
                <Input
                  type="number"
                  className="h-8"
                  disabled={!canEdit}
                  value={style.font.baseSizePt}
                  onChange={(event) =>
                    setStyle((prev) => ({
                      ...prev,
                      font: { ...prev.font, baseSizePt: Number(event.target.value) || 10 },
                    }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">{t("settings.printTemplates.fontFamily")}</Label>
                <Select
                  value={style.font.family}
                  disabled={!canEdit}
                  onValueChange={(value) =>
                    setStyle((prev) => ({
                      ...prev,
                      font: { ...prev.font, family: value as DocumentStyleFontFamily },
                    }))
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">System</SelectItem>
                    <SelectItem value="inter">Inter</SelectItem>
                    <SelectItem value="serif">Serif</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[10px] text-muted-foreground" style={{ fontFamily: fontFamilyCss(style.font.family) }}>
                  Aa Bb Cc · {style.font.family}
                </p>
              </div>
            </fieldset>

            <fieldset className="space-y-2 rounded-md border border-border p-3">
              <legend className="px-1 text-xs font-semibold">{t("settings.printTemplates.tableLook")}</legend>
              <div className="flex items-center gap-2">
                <Switch
                  checked={style.table.zebra}
                  disabled={!canEdit}
                  onCheckedChange={(checked) =>
                    setStyle((prev) => ({ ...prev, table: { ...prev.table, zebra: checked } }))
                  }
                />
                <Label className="text-xs">{t("settings.printTemplates.tableZebra")}</Label>
              </div>
              <div>
                <Label className="text-xs">{t("settings.printTemplates.tableBorders")}</Label>
                <Select
                  value={style.table.borders}
                  disabled={!canEdit}
                  onValueChange={(value) =>
                    setStyle((prev) => ({
                      ...prev,
                      table: {
                        ...prev.table,
                        borders: value === "horizontal" || value === "none" ? value : "all",
                      },
                    }))
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">all</SelectItem>
                    <SelectItem value="horizontal">horizontal</SelectItem>
                    <SelectItem value="none">none</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </fieldset>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {tab === "header"
              ? t("settings.printTemplates.sharedHeaderHint")
              : t("settings.printTemplates.sharedFooterHint")}
          </p>
          <Button type="button" size="sm" disabled={!canEdit} onClick={() => setEditingShared(true)}>
            {t("settings.printTemplates.edit")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t("settings.printTemplates.blocks")}:{" "}
            {tab === "header" ? style.sharedHeader.length : style.sharedFooter.length}
          </p>
        </div>
      )}

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">{t("settings.printTemplates.preview")}</Label>
            <Select value={previewKind} onValueChange={(value) => {
              setPreviewKind(value as PreviewKind);
              setPreviewEntityId("");
            }}>
              <SelectTrigger className="h-8 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="invoice">{t("settings.printTemplates.documentTypes.invoice")}</SelectItem>
                <SelectItem value="act">{t("settings.printTemplates.documentTypes.act")}</SelectItem>
                <SelectItem value="work_order">{t("settings.printTemplates.documentTypes.work_order")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("settings.printTemplates.previewHint")}</Label>
            <Select value={previewEntityId || "__none"} onValueChange={(value) => setPreviewEntityId(value === "__none" ? "" : value)}>
              <SelectTrigger className="h-8 w-56">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">—</SelectItem>
                {entities.map((entity) => (
                  <SelectItem key={entity.id} value={entity.id}>
                    {"invoiceNumber" in entity
                      ? entity.invoiceNumber
                      : `${entity.orderNumber} · ${entity.clientName ?? ""}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {previewHtml ? (
          <iframe title={t("settings.printTemplates.preview")} className="h-[420px] w-full rounded border border-border bg-white" srcDoc={previewHtml} />
        ) : null}
      </div>
    </div>
  );
}
