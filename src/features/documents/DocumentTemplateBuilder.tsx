import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, GripVertical, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Switch } from "../../ui/Switch";
import { Textarea } from "../../ui/Textarea";
import type { DocumentTemplate } from "../../services/apiDocumentTemplates";
import { snapshotBodyHtmlFromLayout } from "../../services/apiDocumentTemplates";
import {
  buildInvoicePrintContext,
  buildOrderPrintContext,
  listRecentInvoicesForPrintPreview,
  listRecentOrdersForPrintPreview,
} from "../../services/printContext";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { cn } from "../../lib/utils";
import { defaultLayoutForType } from "./defaultLayouts";
import {
  layoutPageCss,
  newBlockId,
  type DocumentLayout,
  type DocumentTemplateType,
  type FieldRef,
  type LayoutBlock,
  type TableColumn,
  type TableColumnKey,
  type TotalsRow,
  type TotalsRowKey,
} from "./layout";
import { buildPrintDocument } from "./printTemplate";
import { emptyPrintContext, TEMPLATE_VARIABLES } from "./templateVariables";
import { useSaveDocumentTemplateLayout } from "./useDocumentTemplateMutations";

const BLOCK_KIND_OPTIONS = [
  "companyHeader",
  "documentTitle",
  "fields",
  "table",
  "totals",
  "warranty",
  "text",
  "signatures",
  "spacer",
  "divider",
] as const;

const COLUMN_KEYS: TableColumnKey[] = ["index", "name", "sku", "qty", "unit", "price", "discount", "vat", "sum", "warranty"];
const TOTAL_KEYS: TotalsRowKey[] = ["servicesSum", "materialsSum", "discount", "vat", "total", "paid", "remaining", "totalWords"];

type DocumentTemplateBuilderProps = {
  template: DocumentTemplate;
  canEdit: boolean;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

function cloneLayout(layout: DocumentLayout): DocumentLayout {
  return JSON.parse(JSON.stringify(layout)) as DocumentLayout;
}

function layoutsEqual(a: DocumentLayout, b: DocumentLayout) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function createBlock(kind: (typeof BLOCK_KIND_OPTIONS)[number]): LayoutBlock {
  const id = newBlockId();
  switch (kind) {
    case "companyHeader":
      return {
        id,
        kind,
        enabled: true,
        align: "left",
        fields: TEMPLATE_VARIABLES.filter((v) => v.group === "company").map((v) => ({
          token: v.token,
          label: v.token,
          enabled: true,
        })),
      };
    case "documentTitle":
      return { id, kind, enabled: true, text: "Document" };
    case "fields":
      return { id, kind, enabled: true, title: "Fields", fields: [] };
    case "table":
      return {
        id,
        kind,
        enabled: true,
        title: "Table",
        source: "services",
        showTotalsRow: true,
        columns: COLUMN_KEYS.map((key) => ({ key, label: key, enabled: key !== "sku" && key !== "unit" })),
      };
    case "totals":
      return {
        id,
        kind,
        enabled: true,
        rows: TOTAL_KEYS.map((key) => ({ key, label: key, enabled: true })),
      };
    case "warranty":
      return { id, kind, enabled: true };
    case "text":
      return { id, kind, enabled: true, html: "<p></p>" };
    case "signatures":
      return { id, kind, enabled: true, labels: ["Исполнитель", "Заказчик"] };
    case "spacer":
      return { id, kind, enabled: true, heightMm: 8 };
    case "divider":
      return { id, kind, enabled: true };
  }
}

function SortableRow({
  id,
  children,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  id: string;
  children: ReactNode;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("flex items-start gap-1 rounded-md border border-border bg-card p-2", isDragging && "opacity-70")}
    >
      <button type="button" className="mt-1 text-muted-foreground" aria-label="Drag" {...attributes} {...listeners}>
        <GripVertical className="size-4" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex flex-col gap-0.5">
        <Button type="button" variant="ghost" size="icon-sm" disabled={!canMoveUp} onClick={onMoveUp} aria-label="Move up">
          <ChevronUp className="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" disabled={!canMoveDown} onClick={onMoveDown} aria-label="Move down">
          <ChevronDown className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function reorderById<T extends { id?: string } | FieldRef | TableColumn | TotalsRow>(
  items: T[],
  activeId: string,
  overId: string,
  getId: (item: T, index: number) => string,
) {
  const oldIndex = items.findIndex((item, index) => getId(item, index) === activeId);
  const newIndex = items.findIndex((item, index) => getId(item, index) === overId);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return items;
  return arrayMove(items, oldIndex, newIndex);
}

export function DocumentTemplateBuilder({ template, canEdit, onClose, onDirtyChange }: DocumentTemplateBuilderProps) {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const save = useSaveDocumentTemplateLayout();
  const documentType = (isBuilderType(template.documentType) ? template.documentType : "work_order") as DocumentTemplateType;
  const initialLayout = useMemo(
    () => cloneLayout(template.layout ?? defaultLayoutForType(documentType)),
    [template.layout, documentType],
  );
  const [layout, setLayout] = useState<DocumentLayout>(initialLayout);
  const [name, setName] = useState(template.name);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(layout.blocks[0]?.id ?? null);
  const [previewEntityId, setPreviewEntityId] = useState("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [addToken, setAddToken] = useState("");

  const dirty = !layoutsEqual(layout, initialLayout) || name !== template.name;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const isInvoice = documentType === "invoice";
  const recentOrdersQuery = useQuery({
    queryKey: ["print-builder-preview-orders", workspaceId],
    queryFn: () => listRecentOrdersForPrintPreview(workspaceId, 20),
    enabled: Boolean(workspaceId) && !isInvoice,
    staleTime: 30_000,
  });
  const recentInvoicesQuery = useQuery({
    queryKey: ["print-builder-preview-invoices", workspaceId],
    queryFn: () => listRecentInvoicesForPrintPreview(workspaceId, 20),
    enabled: Boolean(workspaceId) && isInvoice,
    staleTime: 30_000,
  });

  const selectedBlock = layout.blocks.find((block) => block.id === selectedBlockId) ?? null;

  useEffect(() => {
    if (!previewEntityId) {
      setPreviewHtml(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const ctx = isInvoice
            ? await buildInvoicePrintContext(previewEntityId, workspaceId)
            : await buildOrderPrintContext(previewEntityId, workspaceId);
          if (cancelled) return;
          const body = snapshotBodyHtmlFromLayout(layout, ctx, template.showCents);
          setPreviewHtml(buildPrintDocument(body, name || template.name, layoutPageCss(layout.page)));
        } catch {
          if (!cancelled) setPreviewHtml(null);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [layout, previewEntityId, workspaceId, isInvoice, template.showCents, name, template.name]);

  function updateBlock(id: string, updater: (block: LayoutBlock) => LayoutBlock) {
    setLayout((prev) => ({
      ...prev,
      blocks: prev.blocks.map((block) => (block.id === id ? updater(block) : block)),
    }));
  }

  function moveBlock(index: number, direction: -1 | 1) {
    setLayout((prev) => {
      const next = [...prev.blocks];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      return { ...prev, blocks: arrayMove(next, index, target) };
    });
  }

  function onBlocksDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLayout((prev) => ({
      ...prev,
      blocks: reorderById(prev.blocks, String(active.id), String(over.id), (block) => block.id),
    }));
  }

  function resetToDefault() {
    const next = defaultLayoutForType(documentType);
    setLayout(next);
    setSelectedBlockId(next.blocks[0]?.id ?? null);
  }

  function handleSave() {
    if (!canEdit) return;
    const bodyHtml = snapshotBodyHtmlFromLayout(layout, emptyPrintContext({ locale: "ru" }), template.showCents);
    save.mutate(
      { templateId: template.id, layout, bodyHtml, name },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/10 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1 space-y-1">
          <Label htmlFor={`tpl-name-${template.id}`}>{t("settings.printTemplates.name")}</Label>
          <Input
            id={`tpl-name-${template.id}`}
            value={name}
            disabled={!canEdit || save.isPending}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {dirty ? <p className="text-xs text-amber-700 dark:text-amber-400">{t("settings.printTemplates.unsaved")}</p> : null}
        <Button type="button" variant="outline" size="sm" disabled={!canEdit || save.isPending} onClick={resetToDefault}>
          <RotateCcw />
          {t("settings.printTemplates.resetDefault")}
        </Button>
        <Button type="button" size="sm" loading={save.isPending} disabled={!canEdit || save.isPending || !dirty} onClick={handleSave}>
          <Save />
          {t("settings.printTemplates.save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={save.isPending}
          onClick={() => {
            if (dirty && !window.confirm(t("settings.printTemplates.unsavedConfirm"))) return;
            onClose();
          }}
        >
          {t("common.cancel")}
        </Button>
      </div>

      <div className="grid gap-3 xl:grid-cols-[14rem_minmax(0,1fr)_minmax(16rem,20rem)]">
        {/* Blocks list */}
        <section className="space-y-2" aria-label={t("settings.printTemplates.blocks")}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("settings.printTemplates.blocks")}</h3>
            <Select
              disabled={!canEdit}
              onValueChange={(value) => {
                const block = createBlock(value as (typeof BLOCK_KIND_OPTIONS)[number]);
                setLayout((prev) => ({ ...prev, blocks: [...prev.blocks, block] }));
                setSelectedBlockId(block.id);
              }}
            >
              <SelectTrigger className="h-8 w-auto gap-1 px-2" aria-label={t("settings.printTemplates.addBlock")}>
                <Plus className="size-3.5" />
                <SelectValue placeholder={t("settings.printTemplates.addBlock")} />
              </SelectTrigger>
              <SelectContent>
                {BLOCK_KIND_OPTIONS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {t(`settings.printTemplates.blockKinds.${kind}` as "settings.printTemplates.blockKinds.fields")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onBlocksDragEnd}>
            <SortableContext items={layout.blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {layout.blocks.map((block, index) => (
                  <li key={block.id}>
                    <SortableRow
                      id={block.id}
                      canMoveUp={index > 0}
                      canMoveDown={index < layout.blocks.length - 1}
                      onMoveUp={() => moveBlock(index, -1)}
                      onMoveDown={() => moveBlock(index, 1)}
                    >
                      <button
                        type="button"
                        className={cn(
                          "w-full rounded px-1 py-0.5 text-left text-xs",
                          selectedBlockId === block.id ? "bg-primary/10 font-medium" : "hover:bg-muted",
                        )}
                        onClick={() => setSelectedBlockId(block.id)}
                      >
                        {t(`settings.printTemplates.blockKinds.${block.kind}` as "settings.printTemplates.blockKinds.fields")}
                        {block.title ? ` · ${block.title}` : ""}
                        {!block.enabled ? ` (${t("settings.printTemplates.inactive")})` : ""}
                      </button>
                    </SortableRow>
                  </li>
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </section>

        {/* Block + page settings */}
        <section className="space-y-3" aria-label={t("settings.printTemplates.page")}>
          <div className="rounded-md border border-border p-3 space-y-2">
            <h3 className="text-sm font-semibold">{t("settings.printTemplates.page")}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t("settings.printTemplates.pageSize")}</Label>
                <Select
                  value={layout.page.size}
                  disabled={!canEdit}
                  onValueChange={(value) =>
                    setLayout((prev) => ({ ...prev, page: { ...prev.page, size: value as "A4" | "A5" } }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A4">A4</SelectItem>
                    <SelectItem value="A5">A5</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("settings.printTemplates.orientation")}</Label>
                <Select
                  value={layout.page.orientation}
                  disabled={!canEdit}
                  onValueChange={(value) =>
                    setLayout((prev) => ({
                      ...prev,
                      page: { ...prev.page, orientation: value as "portrait" | "landscape" },
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portrait">{t("settings.printTemplates.portrait")}</SelectItem>
                    <SelectItem value="landscape">{t("settings.printTemplates.landscape")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`margins-${template.id}`}>{t("settings.printTemplates.marginsMm")}</Label>
                <Input
                  id={`margins-${template.id}`}
                  type="number"
                  min={0}
                  max={40}
                  value={layout.page.marginsMm}
                  disabled={!canEdit}
                  onChange={(event) =>
                    setLayout((prev) => ({
                      ...prev,
                      page: { ...prev.page, marginsMm: Number(event.target.value) || 0 },
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`font-${template.id}`}>{t("settings.printTemplates.fontSizePt")}</Label>
                <Input
                  id={`font-${template.id}`}
                  type="number"
                  min={7}
                  max={18}
                  value={layout.page.fontSizePt}
                  disabled={!canEdit}
                  onChange={(event) =>
                    setLayout((prev) => ({
                      ...prev,
                      page: { ...prev.page, fontSizePt: Number(event.target.value) || 10 },
                    }))
                  }
                />
              </div>
            </div>
          </div>

          {selectedBlock ? (
            <BlockSettingsPanel
              block={selectedBlock}
              canEdit={canEdit}
              addToken={addToken}
              setAddToken={setAddToken}
              onChange={(next) => updateBlock(selectedBlock.id, () => next)}
              onRemove={() => {
                setLayout((prev) => ({ ...prev, blocks: prev.blocks.filter((block) => block.id !== selectedBlock.id) }));
                setSelectedBlockId(null);
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("settings.printTemplates.selectBlock")}</p>
          )}
        </section>

        {/* Live preview */}
        <section className="space-y-2" aria-label={t("settings.printTemplates.preview")}>
          <h3 className="text-sm font-semibold">{t("settings.printTemplates.preview")}</h3>
          <Select value={previewEntityId} onValueChange={setPreviewEntityId}>
            <SelectTrigger aria-label={isInvoice ? t("settings.printTemplates.variables.previewInvoice") : t("settings.printTemplates.variables.previewOrder")}>
              <SelectValue
                placeholder={
                  isInvoice
                    ? t("settings.printTemplates.variables.previewInvoicePlaceholder")
                    : t("settings.printTemplates.variables.previewOrderPlaceholder")
                }
              />
            </SelectTrigger>
            <SelectContent>
              {isInvoice
                ? (recentInvoicesQuery.data ?? []).map((invoice) => (
                    <SelectItem key={invoice.id} value={invoice.id}>
                      {invoice.invoiceNumber || invoice.id.slice(0, 8)} · {invoice.clientName || "—"}
                    </SelectItem>
                  ))
                : (recentOrdersQuery.data ?? []).map((order) => (
                    <SelectItem key={order.id} value={order.id}>
                      {order.orderNumber || order.id.slice(0, 8)} · {order.clientName || "—"}
                    </SelectItem>
                  ))}
            </SelectContent>
          </Select>
          {previewHtml ? (
            <iframe
              title={t("settings.printTemplates.previewTitle", { name: name || template.name })}
              sandbox=""
              srcDoc={previewHtml}
              className="h-[32rem] w-full rounded-md border border-border bg-white"
            />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
              {t("settings.printTemplates.previewHint")}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function isBuilderType(value: string): value is DocumentTemplateType {
  return value === "work_order" || value === "act" || value === "invoice";
}

function BlockSettingsPanel({
  block,
  canEdit,
  addToken,
  setAddToken,
  onChange,
  onRemove,
}: {
  block: LayoutBlock;
  canEdit: boolean;
  addToken: string;
  setAddToken: (value: string) => void;
  onChange: (block: LayoutBlock) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const fieldTokens = TEMPLATE_VARIABLES.filter((variable) => variable.kind !== "html");

  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {t(`settings.printTemplates.blockKinds.${block.kind}` as "settings.printTemplates.blockKinds.fields")}
        </h3>
        <Button type="button" variant="ghost" size="icon-sm" disabled={!canEdit} onClick={onRemove} aria-label={t("common.delete")}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`enabled-${block.id}`}>{t("settings.printTemplates.enabled")}</Label>
        <Switch
          id={`enabled-${block.id}`}
          checked={block.enabled}
          disabled={!canEdit}
          onCheckedChange={(checked) => onChange({ ...block, enabled: checked })}
        />
      </div>
      {"title" in block || block.kind === "fields" || block.kind === "table" || block.kind === "warranty" ? (
        <div className="space-y-1">
          <Label htmlFor={`title-${block.id}`}>{t("settings.printTemplates.blockTitle")}</Label>
          <Input
            id={`title-${block.id}`}
            value={block.title ?? ""}
            disabled={!canEdit}
            onChange={(event) => onChange({ ...block, title: event.target.value })}
          />
        </div>
      ) : null}

      {block.kind === "documentTitle" ? (
        <div className="space-y-1">
          <Label htmlFor={`text-${block.id}`}>{t("settings.printTemplates.titleText")}</Label>
          <Input
            id={`text-${block.id}`}
            value={block.text}
            disabled={!canEdit}
            onChange={(event) => onChange({ ...block, text: event.target.value })}
          />
        </div>
      ) : null}

      {block.kind === "text" ? (
        <div className="space-y-1">
          <Label htmlFor={`html-${block.id}`}>{t("settings.printTemplates.textHtml")}</Label>
          <Textarea
            id={`html-${block.id}`}
            className="min-h-24 font-mono text-xs"
            value={block.html}
            disabled={!canEdit}
            onChange={(event) => onChange({ ...block, html: event.target.value })}
          />
        </div>
      ) : null}

      {block.kind === "companyHeader" ? (
        <div className="space-y-1">
          <Label>{t("settings.printTemplates.align")}</Label>
          <Select
            value={block.align}
            disabled={!canEdit}
            onValueChange={(value) => onChange({ ...block, align: value as "left" | "center" | "right" })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="left">{t("settings.printTemplates.alignLeft")}</SelectItem>
              <SelectItem value="center">{t("settings.printTemplates.alignCenter")}</SelectItem>
              <SelectItem value="right">{t("settings.printTemplates.alignRight")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {block.kind === "signatures" ? (
        <div className="space-y-1">
          <Label htmlFor={`sig-${block.id}`}>{t("settings.printTemplates.signatures")}</Label>
          <Textarea
            id={`sig-${block.id}`}
            className="min-h-20 text-xs"
            value={block.labels.join("\n")}
            disabled={!canEdit}
            onChange={(event) =>
              onChange({
                ...block,
                labels: event.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>
      ) : null}

      {block.kind === "spacer" ? (
        <div className="space-y-1">
          <Label htmlFor={`spacer-${block.id}`}>{t("settings.printTemplates.spacerMm")}</Label>
          <Input
            id={`spacer-${block.id}`}
            type="number"
            min={1}
            max={80}
            value={block.heightMm ?? 8}
            disabled={!canEdit}
            onChange={(event) => onChange({ ...block, heightMm: Number(event.target.value) || 8 })}
          />
        </div>
      ) : null}

      {block.kind === "table" ? (
        <>
          <div className="space-y-1">
            <Label>{t("settings.printTemplates.tableSource")}</Label>
            <Select
              value={block.source}
              disabled={!canEdit}
              onValueChange={(value) =>
                onChange({
                  ...block,
                  source: value as "services" | "materials" | "allLines" | "invoiceLines",
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="services">{t("settings.printTemplates.sources.services")}</SelectItem>
                <SelectItem value="materials">{t("settings.printTemplates.sources.materials")}</SelectItem>
                <SelectItem value="allLines">{t("settings.printTemplates.sources.allLines")}</SelectItem>
                <SelectItem value="invoiceLines">{t("settings.printTemplates.sources.invoiceLines")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`totals-row-${block.id}`}>{t("settings.printTemplates.showTotalsRow")}</Label>
            <Switch
              id={`totals-row-${block.id}`}
              checked={block.showTotalsRow}
              disabled={!canEdit}
              onCheckedChange={(checked) => onChange({ ...block, showTotalsRow: checked })}
            />
          </div>
          <p className="text-xs font-medium text-muted-foreground">{t("settings.printTemplates.columns")}</p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => {
              const { active, over } = event;
              if (!over || active.id === over.id) return;
              onChange({
                ...block,
                columns: reorderById(block.columns, String(active.id), String(over.id), (column) => column.key),
              });
            }}
          >
            <SortableContext items={block.columns.map((column) => column.key)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {block.columns.map((column, index) => (
                  <li key={column.key}>
                    <SortableRow
                      id={column.key}
                      canMoveUp={index > 0}
                      canMoveDown={index < block.columns.length - 1}
                      onMoveUp={() =>
                        onChange({ ...block, columns: arrayMove(block.columns, index, index - 1) })
                      }
                      onMoveDown={() =>
                        onChange({ ...block, columns: arrayMove(block.columns, index, index + 1) })
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Switch
                          checked={column.enabled}
                          disabled={!canEdit}
                          onCheckedChange={(checked) =>
                            onChange({
                              ...block,
                              columns: block.columns.map((item) =>
                                item.key === column.key ? { ...item, enabled: checked } : item,
                              ),
                            })
                          }
                          aria-label={t("settings.printTemplates.enabled")}
                        />
                        <Input
                          className="h-8 flex-1"
                          value={column.label}
                          disabled={!canEdit}
                          onChange={(event) =>
                            onChange({
                              ...block,
                              columns: block.columns.map((item) =>
                                item.key === column.key ? { ...item, label: event.target.value } : item,
                              ),
                            })
                          }
                          aria-label={t("settings.printTemplates.columnLabel")}
                        />
                        <span className="text-[10px] text-muted-foreground">
                          {t(`settings.printTemplates.columnKeys.${column.key}` as "settings.printTemplates.columnKeys.name")}
                        </span>
                      </div>
                    </SortableRow>
                  </li>
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      ) : null}

      {block.kind === "totals" ? (
        <>
          <p className="text-xs font-medium text-muted-foreground">{t("settings.printTemplates.totalsRows")}</p>
          <ul className="space-y-1.5">
            {block.rows.map((row, index) => (
              <li key={row.key} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
                <Switch
                  checked={row.enabled}
                  disabled={!canEdit}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...block,
                      rows: block.rows.map((item) => (item.key === row.key ? { ...item, enabled: checked } : item)),
                    })
                  }
                />
                <Input
                  className="h-8 flex-1"
                  value={row.label}
                  disabled={!canEdit}
                  onChange={(event) =>
                    onChange({
                      ...block,
                      rows: block.rows.map((item) => (item.key === row.key ? { ...item, label: event.target.value } : item)),
                    })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!canEdit || index === 0}
                  onClick={() => onChange({ ...block, rows: arrayMove(block.rows, index, index - 1) })}
                  aria-label="Move up"
                >
                  <ChevronUp className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!canEdit || index === block.rows.length - 1}
                  onClick={() => onChange({ ...block, rows: arrayMove(block.rows, index, index + 1) })}
                  aria-label="Move down"
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {(block.kind === "fields" || block.kind === "companyHeader") && (
        <>
          <p className="text-xs font-medium text-muted-foreground">{t("settings.printTemplates.fields")}</p>
          <div className="flex flex-wrap gap-2">
            <Select value={addToken} onValueChange={setAddToken} disabled={!canEdit}>
              <SelectTrigger className="min-w-[12rem] flex-1" aria-label={t("settings.printTemplates.addField")}>
                <SelectValue placeholder={t("settings.printTemplates.addField")} />
              </SelectTrigger>
              <SelectContent>
                {fieldTokens.map((variable) => (
                  <SelectItem key={variable.token} value={variable.token}>
                    {variable.token}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canEdit || !addToken}
              onClick={() => {
                if (!addToken) return;
                const exists = block.fields.some((field) => field.token === addToken);
                if (exists) return;
                const variable = TEMPLATE_VARIABLES.find((item) => item.token === addToken);
                onChange({
                  ...block,
                  fields: [...block.fields, { token: addToken, label: variable?.token ?? addToken, enabled: true }],
                });
                setAddToken("");
              }}
            >
              <Plus className="size-3.5" />
              {t("settings.printTemplates.addField")}
            </Button>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => {
              const { active, over } = event;
              if (!over || active.id === over.id) return;
              onChange({
                ...block,
                fields: reorderById(block.fields, String(active.id), String(over.id), (field) => field.token),
              });
            }}
          >
            <SortableContext items={block.fields.map((field) => field.token)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {block.fields.map((field, index) => (
                  <li key={field.token}>
                    <SortableRow
                      id={field.token}
                      canMoveUp={index > 0}
                      canMoveDown={index < block.fields.length - 1}
                      onMoveUp={() => onChange({ ...block, fields: arrayMove(block.fields, index, index - 1) })}
                      onMoveDown={() => onChange({ ...block, fields: arrayMove(block.fields, index, index + 1) })}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Switch
                          checked={field.enabled}
                          disabled={!canEdit}
                          onCheckedChange={(checked) =>
                            onChange({
                              ...block,
                              fields: block.fields.map((item) =>
                                item.token === field.token ? { ...item, enabled: checked } : item,
                              ),
                            })
                          }
                        />
                        <Input
                          className="h-8 flex-1"
                          value={field.label}
                          disabled={!canEdit}
                          onChange={(event) =>
                            onChange({
                              ...block,
                              fields: block.fields.map((item) =>
                                item.token === field.token ? { ...item, label: event.target.value } : item,
                              ),
                            })
                          }
                        />
                        <span className="font-mono text-[10px] text-muted-foreground">{field.token}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={!canEdit}
                          onClick={() =>
                            onChange({ ...block, fields: block.fields.filter((item) => item.token !== field.token) })
                          }
                          aria-label={t("common.delete")}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </SortableRow>
                  </li>
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      )}
    </div>
  );
}

/** Exported for unit tests — reorder helper used by up/down buttons. */
export function moveItemInList<T>(items: T[], from: number, to: number) {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  return arrayMove(items, from, to);
}
