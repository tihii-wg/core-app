import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  type CollisionDetection,
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
import {
  ChevronDown,
  ChevronUp,
  Columns2,
  GripVertical,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Variable,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Switch } from "../../ui/Switch";
import { Textarea } from "../../ui/Textarea";
import { useUnsavedChangesConfirm } from "../../ui/ConfirmProvider";
import type { DocumentTemplate } from "../../services/apiDocumentTemplates";
import { resolvePrintPageCss, snapshotBodyHtmlFromLayout } from "../../services/apiDocumentTemplates";
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
  isDocumentLayout,
  migrateLayoutToV2,
  newBlockId,
  type BlockStyle,
  type ColumnsBlock,
  type DocumentLayout,
  type DocumentTemplateType,
  type FieldRef,
  type LayoutBlock,
  type LayoutColumn,
  type LeafLayoutBlock,
  type TableColumn,
  type TableColumnKey,
  type TableSource,
  type TotalsRow,
  type TotalsRowKey,
} from "./layout";
import { buildPrintDocument } from "./printTemplate";
import {
  emptyPrintContext,
  TEMPLATE_VARIABLES,
  VARIABLE_GROUPS,
  type TemplateVariable,
} from "./templateVariables";
import { DEMO_PRINT_SOURCE_ID, demoPrintContext } from "./demoPrintContext";
import { isDemoPrintSource } from "./templatePreviewHtml";
import { useSaveDocumentTemplateLayout } from "./useDocumentTemplateMutations";
import { useGetDocumentStyle } from "./useGetDocumentStyle";

/* -------------------------------------------------------------------------------------------------
 * Constants & types
 * -----------------------------------------------------------------------------------------------*/

const BLOCK_KIND_OPTIONS = [
  "companyHeader",
  "documentTitle",
  "fields",
  "table",
  "totals",
  "warranty",
  "text",
  "signatures",
  "columns",
  "spacer",
  "divider",
  "styleHeader",
  "styleFooter",
] as const;

type BlockKindOption = (typeof BLOCK_KIND_OPTIONS)[number];
type LeafBlockKind = Exclude<BlockKindOption, "columns">;

const KIND_FALLBACK_LABEL: Record<BlockKindOption, string> = {
  companyHeader: "Company header",
  documentTitle: "Document title",
  fields: "Fields",
  table: "Table",
  totals: "Totals",
  warranty: "Warranty",
  text: "Text",
  signatures: "Signatures",
  columns: "Columns",
  spacer: "Spacer",
  divider: "Divider",
  styleHeader: "Shared header",
  styleFooter: "Shared footer",
};

const TABLE_SOURCES: TableSource[] = [
  "services",
  "materials",
  "allLines",
  "invoiceLines",
  "invoiceWorks",
  "invoiceMaterials",
];

const SOURCE_FALLBACK_LABEL: Record<TableSource, string> = {
  services: "Services",
  materials: "Materials",
  allLines: "All lines",
  invoiceLines: "Invoice lines",
  invoiceWorks: "Invoice works",
  invoiceMaterials: "Invoice materials",
};

const COLUMN_KEYS: TableColumnKey[] = [
  "index",
  "name",
  "sku",
  "qty",
  "unit",
  "price",
  "discount",
  "vat",
  "sum",
  "warranty",
  "performer",
];
const TOTAL_KEYS: TotalsRowKey[] = [
  "servicesSum",
  "materialsSum",
  "discount",
  "net",
  "vat",
  "grossWithVat",
  "total",
  "paid",
  "remaining",
  "totalWords",
];

type WidthPreset = { id: string; label: string; widths: number[] };
const WIDTH_PRESETS: WidthPreset[] = [
  { id: "50-50", label: "50/50", widths: [50, 50] },
  { id: "60-40", label: "60/40", widths: [60, 40] },
  { id: "40-60", label: "40/60", widths: [40, 60] },
  // Sums to exactly 100 so the layout validator (tolerance 0.5) accepts it.
  { id: "33-33-33", label: "33/33/33", widths: [33.34, 33.33, 33.33] },
];

const COLOR_REF_RE = /^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})|theme:(primary|primaryDark|tint|muted|text|border))$/;

const THEME_COLOR_OPTIONS = [
  { value: "theme:primary", labelKey: "settings.printTemplates.colorPrimary" },
  { value: "theme:primaryDark", labelKey: "settings.printTemplates.colorPrimaryDark" },
  { value: "theme:tint", labelKey: "settings.printTemplates.colorTint" },
  { value: "theme:muted", labelKey: "settings.printTemplates.colorMuted" },
  { value: "theme:text", labelKey: "settings.printTemplates.colorText" },
  { value: "theme:border", labelKey: "settings.printTemplates.colorBorder" },
] as const;

/** Droppable id of the root block list. */
const ROOT_ID = "root";
const COLUMN_CONTAINER_PREFIX = "col:";
const VAR_TARGET_ATTR = "data-var-target";

type VarTargetElement = HTMLInputElement | HTMLTextAreaElement;

type DocumentTemplateBuilderProps = {
  template: DocumentTemplate;
  canEdit: boolean;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** When set, Save applies the layout locally instead of persisting (used by DocumentStyleEditor). */
  onSaveLayout?: (layout: DocumentLayout) => void | Promise<void>;
  /** Switch to the visual canvas designer (converts current blocks on open). */
  onConvertToCanvas?: () => void;
};

/* -------------------------------------------------------------------------------------------------
 * i18n helper (keys that may not be in the locale files yet fall back to a default text)
 * -----------------------------------------------------------------------------------------------*/

type KnownKey = "settings.printTemplates.columns";

type Tx = (key: string, defaultValue: string) => string;

function useTx(): Tx {
  const { t } = useTranslation();
  return useCallback((key: string, defaultValue: string) => String(t(key as KnownKey, { defaultValue })), [t]);
}

function columnLabel(tx: Tx, index: number, count: number): string {
  if (index === 0) return tx("settings.printTemplates.leftColumn", "Left column");
  if (index === count - 1) return tx("settings.printTemplates.rightColumn", "Right column");
  return tx("settings.printTemplates.middleColumn", "Middle column");
}

function kindLabel(tx: Tx, kind: BlockKindOption): string {
  return tx(`settings.printTemplates.blockKinds.${kind}`, KIND_FALLBACK_LABEL[kind]);
}

/* -------------------------------------------------------------------------------------------------
 * Pure layout helpers
 * -----------------------------------------------------------------------------------------------*/

function cloneLayout(layout: DocumentLayout): DocumentLayout {
  return JSON.parse(JSON.stringify(layout)) as DocumentLayout;
}

function layoutsEqual(a: DocumentLayout, b: DocumentLayout) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function columnContainerId(columnId: string) {
  return `${COLUMN_CONTAINER_PREFIX}${columnId}`;
}

function isColumnContainerId(id: string) {
  return id.startsWith(COLUMN_CONTAINER_PREFIX);
}

function isColumnsBlock(block: LayoutBlock): block is ColumnsBlock {
  return block.kind === "columns";
}

function createLeafBlock(kind: LeafBlockKind): LeafLayoutBlock {
  const id = newBlockId();
  switch (kind) {
    case "companyHeader":
      return {
        id,
        kind,
        enabled: true,
        align: "left",
        fields: TEMPLATE_VARIABLES.filter((v) => v.group === "company").map((v) => ({
          template: v.token,
          label: "",
          enabled: true,
          hideIfEmpty: true,
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
    case "styleHeader":
      return { id, kind, enabled: true };
    case "styleFooter":
      return { id, kind, enabled: true };
  }
}

function createColumnsBlock(widths: number[] = [50, 50]): ColumnsBlock {
  return {
    id: newBlockId(),
    kind: "columns",
    enabled: true,
    gapMm: 3,
    columns: widths.map((widthPercent) => ({ id: newBlockId("c"), widthPercent, blocks: [] })),
  };
}

/** Creates a block. Nested columns are not allowed: `columns` returns null when `allowColumns` is false. */
function createBlock(kind: BlockKindOption, options: { allowColumns?: boolean } = {}): LayoutBlock | null {
  const { allowColumns = true } = options;
  if (kind === "columns") return allowColumns ? createColumnsBlock() : null;
  return createLeafBlock(kind);
}

type Located = { block: LayoutBlock; containerId: string; index: number };

function getContainerBlocks(blocks: LayoutBlock[], containerId: string): LayoutBlock[] | null {
  if (containerId === ROOT_ID) return blocks;
  for (const block of blocks) {
    if (!isColumnsBlock(block)) continue;
    for (const column of block.columns) {
      if (columnContainerId(column.id) === containerId) return column.blocks;
    }
  }
  return null;
}

function locateBlock(blocks: LayoutBlock[], id: string): Located | null {
  const rootIndex = blocks.findIndex((block) => block.id === id);
  if (rootIndex >= 0) return { block: blocks[rootIndex], containerId: ROOT_ID, index: rootIndex };
  for (const block of blocks) {
    if (!isColumnsBlock(block)) continue;
    for (const column of block.columns) {
      const index = column.blocks.findIndex((child) => child.id === id);
      if (index >= 0) return { block: column.blocks[index], containerId: columnContainerId(column.id), index };
    }
  }
  return null;
}

function replaceContainer(blocks: LayoutBlock[], containerId: string, next: LayoutBlock[]): LayoutBlock[] {
  if (containerId === ROOT_ID) return next;
  return blocks.map((block) => {
    if (!isColumnsBlock(block)) return block;
    if (!block.columns.some((column) => columnContainerId(column.id) === containerId)) return block;
    return {
      ...block,
      columns: block.columns.map((column) =>
        columnContainerId(column.id) === containerId ? { ...column, blocks: next } : column,
      ),
    };
  });
}

function updateBlockDeep(blocks: LayoutBlock[], id: string, updater: (block: LayoutBlock) => LayoutBlock): LayoutBlock[] {
  return blocks.map((block) => {
    if (block.id === id) return updater(block);
    if (!isColumnsBlock(block)) return block;
    return {
      ...block,
      columns: block.columns.map((column) => ({ ...column, blocks: updateBlockDeep(column.blocks, id, updater) })),
    };
  });
}

function removeBlockDeep(blocks: LayoutBlock[], id: string): LayoutBlock[] {
  return blocks
    .filter((block) => block.id !== id)
    .map((block) => {
      if (!isColumnsBlock(block)) return block;
      return {
        ...block,
        columns: block.columns.map((column) => ({ ...column, blocks: removeBlockDeep(column.blocks, id) })),
      };
    });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Moves a block into `containerId` at `index` (append when omitted). Works within a container,
 * between columns and between root and columns. Columns blocks can only live in the root list.
 */
function moveBlockTo(blocks: LayoutBlock[], id: string, containerId: string, index?: number): LayoutBlock[] {
  const from = locateBlock(blocks, id);
  if (!from) return blocks;
  if (from.block.kind === "columns" && containerId !== ROOT_ID) return blocks;
  const target = getContainerBlocks(blocks, containerId);
  if (!target) return blocks;

  if (from.containerId === containerId) {
    const toIndex = clamp(index ?? target.length - 1, 0, target.length - 1);
    if (toIndex === from.index) return blocks;
    return replaceContainer(blocks, containerId, moveItemInList(target, from.index, toIndex));
  }

  const source = getContainerBlocks(blocks, from.containerId);
  if (!source) return blocks;
  const without = replaceContainer(
    blocks,
    from.containerId,
    source.filter((block) => block.id !== id),
  );
  const targetAfter = getContainerBlocks(without, containerId);
  if (!targetAfter) return blocks;
  const at = clamp(index ?? targetAfter.length, 0, targetAfter.length);
  return replaceContainer(without, containerId, [...targetAfter.slice(0, at), from.block, ...targetAfter.slice(at)]);
}

/** Resolves a dnd-kit drop (`overId` can be a block id, the root container or a column container). */
function moveBlockByDrop(blocks: LayoutBlock[], activeId: string, overId: string, placeAfter: boolean): LayoutBlock[] {
  if (overId === ROOT_ID || isColumnContainerId(overId)) return moveBlockTo(blocks, activeId, overId);
  const from = locateBlock(blocks, activeId);
  const to = locateBlock(blocks, overId);
  if (!from || !to) return blocks;
  const index = from.containerId === to.containerId ? to.index : to.index + (placeAfter ? 1 : 0);
  return moveBlockTo(blocks, activeId, to.containerId, index);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/** Sets one column width and redistributes the remainder over the others so the sum stays 100. */
function setColumnWidth(columns: LayoutColumn[], index: number, raw: number): LayoutColumn[] {
  const count = columns.length;
  if (count < 2) return columns;
  const min = 10;
  const max = 100 - min * (count - 1);
  const value = round2(clamp(raw, min, max));
  const rest = 100 - value;
  const othersTotal = columns.reduce((sum, column, i) => (i === index ? sum : sum + column.widthPercent), 0);
  const widths = columns.map((column, i) => {
    if (i === index) return value;
    return round2(othersTotal > 0 ? (column.widthPercent / othersTotal) * rest : rest / (count - 1));
  });
  const drift = round2(100 - widths.reduce((sum, width) => sum + width, 0));
  const fixIndex = index === count - 1 ? count - 2 : count - 1;
  widths[fixIndex] = round2(widths[fixIndex] + drift);
  return columns.map((column, i) => ({ ...column, widthPercent: widths[i] }));
}

/** Applies a width preset; changes the column count (2–3), merging removed columns into the last kept one. */
function applyWidthPreset(block: ColumnsBlock, widths: number[]): ColumnsBlock {
  const columns: LayoutColumn[] = widths.map((widthPercent, i) => {
    const existing = block.columns[i];
    return existing ? { ...existing, widthPercent } : { id: newBlockId("c"), widthPercent, blocks: [] };
  });
  if (block.columns.length > widths.length) {
    const extra = block.columns.slice(widths.length).flatMap((column) => column.blocks);
    const lastIndex = columns.length - 1;
    columns[lastIndex] = { ...columns[lastIndex], blocks: [...columns[lastIndex].blocks, ...extra] };
  }
  return { ...block, columns };
}

function widthsMatch(columns: LayoutColumn[], widths: number[]) {
  return columns.length === widths.length && columns.every((column, i) => Math.abs(column.widthPercent - widths[i]) < 0.51);
}

function patchStyle(style: BlockStyle | undefined, patch: Partial<BlockStyle>): BlockStyle | undefined {
  const next: BlockStyle = { ...style, ...patch };
  for (const key of Object.keys(next) as (keyof BlockStyle)[]) {
    if (next[key] === undefined) delete next[key];
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function fieldTemplateOf(field: FieldRef): string {
  return field.template ?? field.token ?? "";
}

/** Returns a field using `template` only (drops the deprecated `token`). */
function fieldWith(field: FieldRef, patch: Partial<Pick<FieldRef, "label" | "enabled" | "hideIfEmpty">> & { template?: string }): FieldRef {
  return {
    label: patch.label ?? field.label,
    enabled: patch.enabled ?? field.enabled,
    hideIfEmpty: patch.hideIfEmpty ?? field.hideIfEmpty,
    template: patch.template ?? fieldTemplateOf(field),
  };
}

function isBuilderType(value: string): value is DocumentTemplateType {
  return value === "work_order" || value === "act" || value === "invoice";
}

function insertTextAtCursor(
  element: Pick<VarTargetElement, "selectionStart" | "selectionEnd" | "value">,
  text: string,
) {
  const value = element.value;
  const start = element.selectionStart ?? value.length;
  const end = element.selectionEnd ?? start;
  return { next: `${value.slice(0, start)}${text}${value.slice(end)}`, caret: start + text.length };
}

/** Inserts `token` at the caret of a controlled input/textarea and notifies React via a native input event. */
function insertTokenIntoElement(element: VarTargetElement, token: string) {
  const { next, caret } = insertTextAtCursor(element, token);
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) return;
  setter.call(element, next);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  window.requestAnimationFrame(() => {
    if (!element.isConnected) return;
    element.focus();
    element.setSelectionRange(caret, caret);
  });
}

function isVarTarget(target: EventTarget): target is VarTargetElement {
  return (
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
    target.getAttribute(VAR_TARGET_ATTR) === "true"
  );
}

/** Exported for unit tests — reorder helper used by up/down buttons. */
export function moveItemInList<T>(items: T[], from: number, to: number) {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  return arrayMove(items, from, to);
}

/* -------------------------------------------------------------------------------------------------
 * Small input helpers
 * -----------------------------------------------------------------------------------------------*/

/** Color input: hex or theme:* refs; invalid drafts revert on blur. */
function HexColorInput({
  id,
  label,
  value,
  disabled,
  onCommit,
}: {
  id: string;
  label: string;
  value: string | undefined;
  disabled: boolean;
  onCommit: (next: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value ?? "");
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setDraft(value ?? "");
  }
  const invalid = draft !== "" && !COLOR_REF_RE.test(draft);
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value?.startsWith("theme:") ? value : "__custom"}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === "__custom") {
            onCommit(value?.startsWith("theme:") ? "#000000" : value);
            return;
          }
          onCommit(next);
        }}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder={t("settings.printTemplates.themeColors")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__custom">{t("settings.printTemplates.styleDefault")}</SelectItem>
          {THEME_COLOR_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {t(option.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        id={id}
        className="h-8 font-mono text-xs"
        placeholder="#000000 or theme:primary"
        value={draft}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (next === "") onCommit(undefined);
          else if (COLOR_REF_RE.test(next)) onCommit(next);
        }}
        onBlur={() => {
          if (invalid) setDraft(value ?? "");
        }}
      />
    </div>
  );
}

/** Number input that commits on blur / Enter (so intermediate typing like "0." is not rejected). */
function NumberDraftInput({
  id,
  value,
  min,
  max,
  step,
  disabled,
  allowEmpty = false,
  className,
  onCommit,
  ariaLabel,
}: {
  id?: string;
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  disabled: boolean;
  allowEmpty?: boolean;
  className?: string;
  ariaLabel?: string;
  onCommit: (next: number | undefined) => void;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setDraft(value == null ? "" : String(value));
  }
  function commit() {
    if (draft.trim() === "") {
      if (allowEmpty) onCommit(undefined);
      else setDraft(value == null ? "" : String(value));
      return;
    }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(value == null ? "" : String(value));
      return;
    }
    const next = clamp(parsed, min, max);
    setDraft(String(next));
    onCommit(next);
  }
  return (
    <Input
      id={id}
      type="number"
      className={className}
      min={min}
      max={max}
      step={step}
      value={draft}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

/* -------------------------------------------------------------------------------------------------
 * Sortable building blocks
 * -----------------------------------------------------------------------------------------------*/

function SortableRow({
  id,
  children,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  disabled = false,
}: {
  id: string;
  children: ReactNode;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  disabled?: boolean;
}) {
  const tx = useTx();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
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
      <button
        type="button"
        className="mt-1 text-muted-foreground disabled:opacity-50"
        aria-label="Drag"
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex flex-col gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled || !canMoveUp}
          onClick={onMoveUp}
          aria-label={tx("settings.printTemplates.moveUp", "Move up")}
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled || !canMoveDown}
          onClick={onMoveDown}
          aria-label={tx("settings.printTemplates.moveDown", "Move down")}
        >
          <ChevronDown className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function RootDropZone({ children }: { children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: ROOT_ID });
  return (
    <div ref={setNodeRef} className="min-h-8">
      {children}
    </div>
  );
}

function ColumnDropZone({
  column,
  label,
  children,
}: {
  column: LayoutColumn;
  label: string;
  children: ReactNode;
}) {
  const tx = useTx();
  const { setNodeRef, isOver } = useDroppable({ id: columnContainerId(column.id) });
  return (
    <div
      ref={setNodeRef}
      className={cn("rounded-md border border-dashed border-border p-1.5", isOver && "border-primary bg-primary/5")}
    >
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label} · {column.widthPercent}%
      </p>
      <SortableContext items={column.blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
        <ul className="min-h-6 space-y-1.5">{children}</ul>
      </SortableContext>
      {column.blocks.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">{tx("settings.printTemplates.emptyColumn", "Drop blocks here")}</p>
      ) : null}
    </div>
  );
}

function BlockLabelButton({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn("w-full rounded px-1 py-0.5 text-left text-xs", selected ? "bg-primary/10 font-medium" : "hover:bg-muted")}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/* -------------------------------------------------------------------------------------------------
 * Variable picker
 * -----------------------------------------------------------------------------------------------*/

function VariablePicker({
  disabled,
  onInsert,
}: {
  disabled: boolean;
  onInsert: (token: string) => void;
}) {
  const { t } = useTranslation();
  const tx = useTx();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const labelOf = useCallback((variable: TemplateVariable) => tx(variable.labelKey, variable.token), [tx]);

  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    return VARIABLE_GROUPS.map((group) => ({
      group,
      items: TEMPLATE_VARIABLES.filter((variable) => {
        if (variable.group !== group) return false;
        if (!query) return true;
        return variable.token.toLowerCase().includes(query) || labelOf(variable).toLowerCase().includes(query);
      }),
    })).filter((entry) => entry.items.length > 0);
  }, [search, labelOf]);

  return (
    <div className="space-y-2">
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setOpen((prev) => !prev)}>
        <Variable className="size-3.5" />
        {t("settings.printTemplates.insertVariable")}
      </Button>
      {open ? (
        <div className="space-y-2 rounded-md border border-border bg-card p-2 shadow-sm">
          <p className="text-[11px] text-muted-foreground">{t("settings.printTemplates.variables.hint")}</p>
          <Input
            className="h-8"
            value={search}
            placeholder={t("settings.printTemplates.variables.search")}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {groups.map(({ group, items }) => (
              <div key={group} className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {tx(`settings.printTemplates.variables.groups.${group}`, group)}
                </p>
                <ul className="space-y-0.5">
                  {items.map((variable) => (
                    <li key={variable.token}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted"
                        // Keep the caret in the focused text field.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onInsert(variable.token)}
                      >
                        <span className="truncate">{labelOf(variable)}</span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{variable.token}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------------
 * Block style panel
 * -----------------------------------------------------------------------------------------------*/

const DEFAULT_OPTION = "default";

function StyleEditor({
  blockId,
  style,
  canEdit,
  onChange,
}: {
  blockId: string;
  style: BlockStyle | undefined;
  canEdit: boolean;
  onChange: (next: BlockStyle | undefined) => void;
}) {
  const { t } = useTranslation();
  const tx = useTx();
  const defaultLabel = tx("settings.printTemplates.styleDefault", "Default");

  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      <p className="text-xs font-medium text-muted-foreground">{t("settings.printTemplates.blockStyle")}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <HexColorInput
          id={`style-bg-${blockId}`}
          label={t("settings.printTemplates.background")}
          value={style?.background}
          disabled={!canEdit}
          onCommit={(next) => onChange(patchStyle(style, { background: next }))}
        />
        <HexColorInput
          id={`style-color-${blockId}`}
          label={t("settings.printTemplates.textColor")}
          value={style?.color}
          disabled={!canEdit}
          onCommit={(next) => onChange(patchStyle(style, { color: next }))}
        />
        <HexColorInput
          id={`style-title-${blockId}`}
          label={t("settings.printTemplates.titleColor")}
          value={style?.titleColor}
          disabled={!canEdit}
          onCommit={(next) => onChange(patchStyle(style, { titleColor: next }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label>{t("settings.printTemplates.border")}</Label>
          <Select
            value={style?.border ?? DEFAULT_OPTION}
            disabled={!canEdit}
            onValueChange={(value) =>
              onChange(patchStyle(style, { border: value === "none" || value === "box" ? value : undefined }))
            }
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_OPTION}>{defaultLabel}</SelectItem>
              <SelectItem value="none">{tx("settings.printTemplates.borderNone", "None")}</SelectItem>
              <SelectItem value="box">{tx("settings.printTemplates.borderBox", "Box")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t("settings.printTemplates.padding")}</Label>
          <Select
            value={style?.padding ?? DEFAULT_OPTION}
            disabled={!canEdit}
            onValueChange={(value) =>
              onChange(
                patchStyle(style, {
                  padding: value === "none" || value === "sm" || value === "md" ? value : undefined,
                }),
              )
            }
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_OPTION}>{defaultLabel}</SelectItem>
              <SelectItem value="none">{tx("settings.printTemplates.paddingNone", "None")}</SelectItem>
              <SelectItem value="sm">{tx("settings.printTemplates.paddingSm", "Small")}</SelectItem>
              <SelectItem value="md">{tx("settings.printTemplates.paddingMd", "Medium")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t("settings.printTemplates.align")}</Label>
          <Select
            value={style?.align ?? DEFAULT_OPTION}
            disabled={!canEdit}
            onValueChange={(value) =>
              onChange(
                patchStyle(style, {
                  align: value === "left" || value === "center" || value === "right" ? value : undefined,
                }),
              )
            }
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_OPTION}>{defaultLabel}</SelectItem>
              <SelectItem value="left">{t("settings.printTemplates.alignLeft")}</SelectItem>
              <SelectItem value="center">{t("settings.printTemplates.alignCenter")}</SelectItem>
              <SelectItem value="right">{t("settings.printTemplates.alignRight")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`style-scale-${blockId}`}>{t("settings.printTemplates.fontScale")}</Label>
          <NumberDraftInput
            id={`style-scale-${blockId}`}
            className="h-8"
            value={style?.fontScale}
            min={0.5}
            max={3}
            step={0.05}
            allowEmpty
            disabled={!canEdit}
            onCommit={(next) => onChange(patchStyle(style, { fontScale: next }))}
          />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------------
 * Columns settings
 * -----------------------------------------------------------------------------------------------*/

function ColumnsSettings({
  block,
  canEdit,
  onChange,
}: {
  block: ColumnsBlock;
  canEdit: boolean;
  onChange: (block: ColumnsBlock) => void;
}) {
  const { t } = useTranslation();
  const tx = useTx();
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{t("settings.printTemplates.columnWidth")}</p>
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">{t("settings.printTemplates.widthPreset")}</Label>
        <div className="flex flex-wrap gap-1.5">
          {WIDTH_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              size="sm"
              variant={widthsMatch(block.columns, preset.widths) ? "default" : "outline"}
              disabled={!canEdit}
              onClick={() => onChange(applyWidthPreset(block, preset.widths))}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>
      <div className={cn("grid gap-2", block.columns.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {block.columns.map((column, index) => (
          <div key={column.id} className="space-y-1">
            <Label htmlFor={`col-width-${column.id}`}>{columnLabel(tx, index, block.columns.length)} (%)</Label>
            <NumberDraftInput
              id={`col-width-${column.id}`}
              className="h-8"
              value={column.widthPercent}
              min={10}
              max={90}
              step={1}
              disabled={!canEdit}
              onCommit={(next) => {
                if (next == null) return;
                onChange({ ...block, columns: setColumnWidth(block.columns, index, next) });
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------------
 * Fields editor (fields + companyHeader)
 * -----------------------------------------------------------------------------------------------*/

function FieldsEditor({
  blockId,
  fields,
  canEdit,
  onChange,
}: {
  blockId: string;
  fields: FieldRef[];
  canEdit: boolean;
  onChange: (fields: FieldRef[]) => void;
}) {
  const { t } = useTranslation();
  const tx = useTx();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [addToken, setAddToken] = useState("");
  const fieldTokens = TEMPLATE_VARIABLES.filter((variable) => variable.kind !== "html");
  const ids = fields.map((_, index) => `${blockId}:field:${index}`);

  function updateField(index: number, next: FieldRef) {
    onChange(fields.map((field, i) => (i === index ? next : field)));
  }

  return (
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
                {tx(variable.labelKey, variable.token)} · {variable.token}
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
            const variable = TEMPLATE_VARIABLES.find((item) => item.token === addToken);
            onChange([
              ...fields,
              {
                template: addToken,
                label: variable ? tx(variable.labelKey, variable.token) : addToken,
                enabled: true,
                hideIfEmpty: true,
              },
            ]);
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
          const from = ids.indexOf(String(active.id));
          const to = ids.indexOf(String(over.id));
          if (from < 0 || to < 0) return;
          onChange(moveItemInList(fields, from, to));
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1.5">
            {fields.map((field, index) => (
              <li key={ids[index]}>
                <SortableRow
                  id={ids[index]}
                  disabled={!canEdit}
                  canMoveUp={index > 0}
                  canMoveDown={index < fields.length - 1}
                  onMoveUp={() => onChange(moveItemInList(fields, index, index - 1))}
                  onMoveDown={() => onChange(moveItemInList(fields, index, index + 1))}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={field.enabled}
                        disabled={!canEdit}
                        aria-label={t("settings.printTemplates.enabled")}
                        onCheckedChange={(checked) => updateField(index, fieldWith(field, { enabled: checked }))}
                      />
                      <div className="ml-auto flex items-center gap-1.5">
                        <Switch
                          id={`hide-${ids[index]}`}
                          checked={field.hideIfEmpty !== false}
                          disabled={!canEdit}
                          onCheckedChange={(checked: boolean) =>
                            updateField(index, fieldWith(field, { hideIfEmpty: checked }))
                          }
                        />
                        <Label htmlFor={`hide-${ids[index]}`} className="text-xs">
                          {t("settings.printTemplates.hideIfEmpty")}
                        </Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={!canEdit}
                          onClick={() => onChange(fields.filter((_, i) => i !== index))}
                          aria-label={t("common.delete")}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`label-${ids[index]}`} className="text-[11px] text-muted-foreground">
                        {t("settings.printTemplates.fieldLabel")}
                      </Label>
                      <Input
                        id={`label-${ids[index]}`}
                        className="h-8"
                        data-var-target="true"
                        value={field.label}
                        disabled={!canEdit}
                        onChange={(event) => updateField(index, fieldWith(field, { label: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`tpl-${ids[index]}`} className="text-[11px] text-muted-foreground">
                        {t("settings.printTemplates.fieldValue")}
                      </Label>
                      <Input
                        id={`tpl-${ids[index]}`}
                        className="h-8 font-mono text-xs"
                        data-var-target="true"
                        value={fieldTemplateOf(field)}
                        disabled={!canEdit}
                        onChange={(event) => updateField(index, fieldWith(field, { template: event.target.value }))}
                      />
                    </div>
                  </div>
                </SortableRow>
              </li>
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </>
  );
}

/* -------------------------------------------------------------------------------------------------
 * Block settings panel
 * -----------------------------------------------------------------------------------------------*/

type ColumnTarget = { containerId: string; label: string };

function BlockSettingsPanel({
  block,
  canEdit,
  canMoveUp,
  canMoveDown,
  inColumn,
  columnTargets,
  onMoveUp,
  onMoveDown,
  onMoveToContainer,
  onChange,
  onRemove,
  onInsertVariable,
}: {
  block: LayoutBlock;
  canEdit: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  inColumn: boolean;
  columnTargets: ColumnTarget[];
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveToContainer: (containerId: string) => void;
  onChange: (block: LayoutBlock) => void;
  onRemove: () => void;
  onInsertVariable: (token: string) => void;
}) {
  const { t } = useTranslation();
  const tx = useTx();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const showVariablePicker =
    block.kind !== "spacer" && block.kind !== "divider" && block.kind !== "columns" && block.kind !== "signatures";
  const showTitleInput =
    block.kind === "fields" ||
    block.kind === "table" ||
    block.kind === "totals" ||
    block.kind === "warranty" ||
    block.title != null;

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{kindLabel(tx, block.kind)}</h3>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!canEdit || !canMoveUp}
            onClick={onMoveUp}
            aria-label={tx("settings.printTemplates.moveUp", "Move up")}
          >
            <ChevronUp className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!canEdit || !canMoveDown}
            onClick={onMoveDown}
            aria-label={tx("settings.printTemplates.moveDown", "Move down")}
          >
            <ChevronDown className="size-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" disabled={!canEdit} onClick={onRemove} aria-label={t("common.delete")}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {block.kind !== "columns" && (inColumn || columnTargets.length > 0) ? (
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">{t("settings.printTemplates.moveToColumn")}</Label>
          <div className="flex flex-wrap gap-1.5">
            {columnTargets.map((target) => (
              <Button
                key={target.containerId}
                type="button"
                size="sm"
                variant="outline"
                disabled={!canEdit}
                onClick={() => onMoveToContainer(target.containerId)}
              >
                {target.label}
              </Button>
            ))}
            {inColumn ? (
              <Button type="button" size="sm" variant="outline" disabled={!canEdit} onClick={() => onMoveToContainer(ROOT_ID)}>
                {tx("settings.printTemplates.moveToRoot", "Move out of columns")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`enabled-${block.id}`}>{t("settings.printTemplates.enabled")}</Label>
        <Switch
          id={`enabled-${block.id}`}
          checked={block.enabled}
          disabled={!canEdit}
          onCheckedChange={(checked) => onChange({ ...block, enabled: checked })}
        />
      </div>

      {showVariablePicker ? <VariablePicker disabled={!canEdit} onInsert={onInsertVariable} /> : null}

      {showTitleInput ? (
        <div className="space-y-1">
          <Label htmlFor={`title-${block.id}`}>{t("settings.printTemplates.blockTitle")}</Label>
          <Input
            id={`title-${block.id}`}
            data-var-target="true"
            value={block.title ?? ""}
            disabled={!canEdit}
            onChange={(event) => onChange({ ...block, title: event.target.value })}
          />
        </div>
      ) : null}

      {block.kind === "columns" ? (
        <ColumnsSettings block={block} canEdit={canEdit} onChange={onChange} />
      ) : null}

      {block.kind === "documentTitle" ? (
        <div className="space-y-1">
          <Label htmlFor={`text-${block.id}`}>{t("settings.printTemplates.titleText")}</Label>
          <Input
            id={`text-${block.id}`}
            data-var-target="true"
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
            data-var-target="true"
            value={block.html}
            disabled={!canEdit}
            onChange={(event) => onChange({ ...block, html: event.target.value })}
          />
        </div>
      ) : null}

      {block.kind === "signatures" ? (
        <div className="space-y-2">
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
          <div className="space-y-1">
            <Label htmlFor={`sig-date-${block.id}`}>{t("settings.printTemplates.builder.dateCaption")}</Label>
            <Input
              id={`sig-date-${block.id}`}
              value={block.dateLabel ?? ""}
              disabled={!canEdit}
              placeholder={t("settings.printTemplates.builder.signatureDate")}
              onChange={(event) => onChange({ ...block, dateLabel: event.target.value })}
            />
          </div>
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
              onValueChange={(value) => {
                const source = TABLE_SOURCES.find((item) => item === value);
                if (source) onChange({ ...block, source });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TABLE_SOURCES.map((source) => (
                  <SelectItem key={source} value={source}>
                    {tx(`settings.printTemplates.sources.${source}`, SOURCE_FALLBACK_LABEL[source])}
                  </SelectItem>
                ))}
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
              const keys = block.columns.map((column) => column.key as string);
              const from = keys.indexOf(String(active.id));
              const to = keys.indexOf(String(over.id));
              if (from < 0 || to < 0) return;
              onChange({ ...block, columns: moveItemInList<TableColumn>(block.columns, from, to) });
            }}
          >
            <SortableContext items={block.columns.map((column) => column.key)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {block.columns.map((column, index) => (
                  <li key={column.key}>
                    <SortableRow
                      id={column.key}
                      disabled={!canEdit}
                      canMoveUp={index > 0}
                      canMoveDown={index < block.columns.length - 1}
                      onMoveUp={() => onChange({ ...block, columns: moveItemInList(block.columns, index, index - 1) })}
                      onMoveDown={() => onChange({ ...block, columns: moveItemInList(block.columns, index, index + 1) })}
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
            {block.rows.map((row: TotalsRow, index) => (
              <li key={row.key} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
                <Switch
                  checked={row.enabled}
                  disabled={!canEdit}
                  aria-label={t("settings.printTemplates.enabled")}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...block,
                      rows: block.rows.map((item) => (item.key === row.key ? { ...item, enabled: checked } : item)),
                    })
                  }
                />
                <Input
                  className="h-8 flex-1"
                  data-var-target="true"
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
                  onClick={() => onChange({ ...block, rows: moveItemInList(block.rows, index, index - 1) })}
                  aria-label={tx("settings.printTemplates.moveUp", "Move up")}
                >
                  <ChevronUp className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!canEdit || index === block.rows.length - 1}
                  onClick={() => onChange({ ...block, rows: moveItemInList(block.rows, index, index + 1) })}
                  aria-label={tx("settings.printTemplates.moveDown", "Move down")}
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {block.kind === "fields" || block.kind === "companyHeader" ? (
        <FieldsEditor
          blockId={block.id}
          fields={block.fields}
          canEdit={canEdit}
          onChange={(fields) => onChange({ ...block, fields })}
        />
      ) : null}

      <StyleEditor
        blockId={block.id}
        style={block.style}
        canEdit={canEdit}
        onChange={(style) =>
          onChange(
            block.kind === "companyHeader"
              ? { ...block, style, align: style?.align ?? block.align }
              : { ...block, style },
          )
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------------------------------------
 * Main builder
 * -----------------------------------------------------------------------------------------------*/

export function DocumentTemplateBuilder({
  template,
  canEdit,
  onClose,
  onDirtyChange,
  onSaveLayout,
  onConvertToCanvas,
}: DocumentTemplateBuilderProps) {
  const { t } = useTranslation();
  const confirmUnsaved = useUnsavedChangesConfirm();
  const tx = useTx();
  const { workspaceId } = useActiveWorkspaceId();
  const save = useSaveDocumentTemplateLayout();
  const documentType = (isBuilderType(template.documentType) ? template.documentType : "work_order") as DocumentTemplateType;
  const initialLayout = useMemo(() => {
    const raw = template.layout;
    if (raw && isDocumentLayout(raw)) return migrateLayoutToV2(cloneLayout(raw));
    return migrateLayoutToV2(cloneLayout(defaultLayoutForType(documentType)));
  }, [template.layout, documentType]);
  const [layout, setLayout] = useState<DocumentLayout>(initialLayout);
  const [name, setName] = useState(template.name);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(layout.blocks[0]?.id ?? null);
  const [previewEntityId, setPreviewEntityId] = useState(DEMO_PRINT_SOURCE_ID);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [localSavePending, setLocalSavePending] = useState(false);
  const focusedTargetRef = useRef<VarTargetElement | null>(null);
  const documentStyleQuery = useGetDocumentStyle();

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

  const selected = selectedBlockId ? locateBlock(layout.blocks, selectedBlockId) : null;
  const selectedBlock = selected?.block ?? null;

  const selectedSiblings = selected ? getContainerBlocks(layout.blocks, selected.containerId) : null;

  const columnTargets = useMemo<ColumnTarget[]>(() => {
    if (!selected || selected.block.kind === "columns") return [];
    const columnsBlocks = layout.blocks.filter(isColumnsBlock);
    const inColumn = selected.containerId !== ROOT_ID;
    const candidates = inColumn
      ? columnsBlocks.filter((cb) => cb.columns.some((column) => columnContainerId(column.id) === selected.containerId))
      : columnsBlocks;
    const targets: ColumnTarget[] = [];
    for (const cb of candidates) {
      const blockNumber = columnsBlocks.indexOf(cb) + 1;
      cb.columns.forEach((column, index) => {
        const containerId = columnContainerId(column.id);
        if (containerId === selected.containerId) return;
        const base = columnLabel(tx, index, cb.columns.length);
        targets.push({ containerId, label: !inColumn && columnsBlocks.length > 1 ? `#${blockNumber} ${base}` : base });
      });
    }
    return targets;
  }, [layout.blocks, selected, tx]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const ctx = isDemoPrintSource(previewEntityId)
            ? demoPrintContext({ documentType, locale: "en" })
            : isInvoice
              ? await buildInvoicePrintContext(previewEntityId, workspaceId)
              : await buildOrderPrintContext(previewEntityId, workspaceId, documentType);
          if (cancelled) return;
          const documentStyle = documentStyleQuery.data;
          const body = snapshotBodyHtmlFromLayout(layout, ctx, template.showCents, documentStyle);
          setPreviewHtml(
            buildPrintDocument(
              body,
              name || template.name,
              documentStyle ? resolvePrintPageCss(layout, documentStyle) : undefined,
            ),
          );
        } catch {
          if (!cancelled) setPreviewHtml(null);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    layout,
    previewEntityId,
    workspaceId,
    isInvoice,
    documentType,
    template.showCents,
    name,
    template.name,
    documentStyleQuery.data,
  ]);

  /* ---- layout mutations ---- */

  function updateBlock(id: string, next: LayoutBlock) {
    setLayout((prev) => ({ ...prev, version: 2, blocks: updateBlockDeep(prev.blocks, id, () => next) }));
  }

  function moveBlockStep(id: string, direction: -1 | 1) {
    setLayout((prev) => {
      const located = locateBlock(prev.blocks, id);
      if (!located) return prev;
      const list = getContainerBlocks(prev.blocks, located.containerId);
      if (!list) return prev;
      const target = located.index + direction;
      if (target < 0 || target >= list.length) return prev;
      return { ...prev, blocks: replaceContainer(prev.blocks, located.containerId, moveItemInList(list, located.index, target)) };
    });
  }

  function moveBlockToContainer(id: string, containerId: string) {
    setLayout((prev) => ({ ...prev, blocks: moveBlockTo(prev.blocks, id, containerId) }));
  }

  function addBlock(kind: BlockKindOption) {
    const block = createBlock(kind);
    if (!block) return;
    setLayout((prev) => ({ ...prev, blocks: [...prev.blocks, block] }));
    setSelectedBlockId(block.id);
  }

  function resetToDefault() {
    const next = migrateLayoutToV2(defaultLayoutForType(documentType));
    setLayout(next);
    setSelectedBlockId(next.blocks[0]?.id ?? null);
  }

  function handleSave() {
    if (!canEdit) return;
    const toSave: DocumentLayout = { ...layout, version: 2 };
    if (onSaveLayout) {
      setLocalSavePending(true);
      void Promise.resolve(onSaveLayout(toSave))
        .then(() => onClose())
        .finally(() => setLocalSavePending(false));
      return;
    }
    const bodyHtml = snapshotBodyHtmlFromLayout(
      toSave,
      emptyPrintContext({ locale: "ru", documentKind: documentType }),
      template.showCents,
      documentStyleQuery.data,
    );
    save.mutate(
      { templateId: template.id, layout: toSave, bodyHtml, name },
      { onSuccess: () => onClose() },
    );
  }

  const savePending = save.isPending || localSavePending;

  /* ---- drag & drop (root list + every column) ---- */

  const { rootIds, columnsBlockIds } = useMemo(
    () => ({
      rootIds: new Set(layout.blocks.map((block) => block.id)),
      columnsBlockIds: new Set(layout.blocks.filter(isColumnsBlock).map((block) => block.id)),
    }),
    [layout.blocks],
  );

  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      const activeId = String(args.active.id);
      const rootLevel = args.droppableContainers.filter((container) => {
        const id = String(container.id);
        return id !== ROOT_ID && rootIds.has(id);
      });
      const rootFallback =
        rootLevel.length > 0 ? rootLevel : args.droppableContainers.filter((container) => container.id === ROOT_ID);

      // Columns blocks can only be reordered among root blocks.
      if (columnsBlockIds.has(activeId)) {
        return closestCenter({ ...args, droppableContainers: rootFallback });
      }

      // Leaf blocks may target any column or root item, but never the columns wrapper itself
      // (otherwise the large wrapper rect would shadow the columns inside it).
      const inner = args.droppableContainers.filter((container) => !columnsBlockIds.has(String(container.id)));
      if (!args.pointerCoordinates) return closestCenter({ ...args, droppableContainers: inner });

      const hits = pointerWithin({ ...args, droppableContainers: inner }).filter((hit) => hit.id !== ROOT_ID);
      if (hits.length > 0) {
        const items = hits.filter((hit) => !isColumnContainerId(String(hit.id)));
        return items.length > 0 ? items : hits;
      }
      return closestCenter({ ...args, droppableContainers: rootFallback });
    },
    [rootIds, columnsBlockIds],
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !canEdit) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;
    const translated = active.rect.current.translated;
    const placeAfter = translated != null && translated.top + translated.height / 2 > over.rect.top + over.rect.height / 2;
    setLayout((prev) => ({ ...prev, blocks: moveBlockByDrop(prev.blocks, activeId, overId, placeAfter) }));
  }

  /* ---- variable insertion ---- */

  function handleSettingsFocus(event: FocusEvent<HTMLElement>) {
    if (isVarTarget(event.target)) focusedTargetRef.current = event.target;
  }

  function insertVariable(token: string) {
    const element = focusedTargetRef.current;
    if (!element || !element.isConnected || element.disabled) return;
    insertTokenIntoElement(element, token);
  }

  function describeBlock(block: LayoutBlock) {
    const base = kindLabel(tx, block.kind);
    const suffix =
      block.kind === "columns"
        ? ` · ${block.columns.map((column) => Math.round(column.widthPercent)).join("/")}`
        : block.title
          ? ` · ${block.title}`
          : "";
    return `${base}${suffix}${!block.enabled ? ` (${t("settings.printTemplates.inactive")})` : ""}`;
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/10 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1 space-y-1">
          <Label htmlFor={`tpl-name-${template.id}`}>{t("settings.printTemplates.name")}</Label>
          <Input
            id={`tpl-name-${template.id}`}
            value={name}
            disabled={!canEdit || savePending || Boolean(onSaveLayout)}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {!onSaveLayout ? (
          <div className="flex items-center gap-2">
            <Switch
              checked={layout.useStyle === true}
              disabled={!canEdit || savePending}
              onCheckedChange={(checked) => setLayout((prev) => ({ ...prev, useStyle: checked }))}
            />
            <Label className="text-xs">{t("settings.printTemplates.useCommonStyle")}</Label>
          </div>
        ) : null}
        {dirty ? <p className="text-xs text-amber-700 dark:text-amber-400">{t("settings.printTemplates.unsaved")}</p> : null}
        {!onSaveLayout ? (
          <Button type="button" variant="outline" size="sm" disabled={!canEdit || savePending} onClick={resetToDefault}>
            <RotateCcw />
            {t("settings.printTemplates.resetDefault")}
          </Button>
        ) : null}
        {onConvertToCanvas ? (
          <Button type="button" variant="outline" size="sm" disabled={!canEdit || savePending} onClick={onConvertToCanvas}>
            {t("settings.printTemplates.canvas.convertToCanvas")}
          </Button>
        ) : null}
        <Button type="button" size="sm" loading={savePending} disabled={!canEdit || savePending || !dirty} onClick={handleSave}>
          <Save />
          {t("settings.printTemplates.save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={savePending}
          onClick={() => {
            void (async () => {
              if (dirty && !(await confirmUnsaved())) return;
              onClose();
            })();
          }}
        >
          {t("common.cancel")}
        </Button>
      </div>
      {!onSaveLayout && layout.useStyle === true ? (
        <p className="text-xs text-muted-foreground">{t("settings.printTemplates.sharedStyleHint")}</p>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[16rem_minmax(0,1fr)_minmax(16rem,20rem)]">
        {/* Blocks tree */}
        <section className="space-y-2" aria-label={t("settings.printTemplates.blocks")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("settings.printTemplates.blocks")}</h3>
            <div className="flex items-center gap-1">
              <Button type="button" size="sm" variant="outline" disabled={!canEdit} onClick={() => addBlock("columns")}>
                <Columns2 className="size-3.5" />
                {t("settings.printTemplates.addColumns")}
              </Button>
              <Select disabled={!canEdit} value="" onValueChange={(value) => {
                const kind = BLOCK_KIND_OPTIONS.find((item) => item === value);
                if (kind) addBlock(kind);
              }}>
                <SelectTrigger className="h-8 w-auto gap-1 px-2" aria-label={t("settings.printTemplates.addBlock")}>
                  <Plus className="size-3.5" />
                  <SelectValue placeholder={t("settings.printTemplates.addBlock")} />
                </SelectTrigger>
                <SelectContent>
                  {BLOCK_KIND_OPTIONS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {kindLabel(tx, kind)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={handleDragEnd}>
            <RootDropZone>
              <SortableContext items={layout.blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-1.5">
                  {layout.blocks.map((block, index) => (
                    <li key={block.id}>
                      <SortableRow
                        id={block.id}
                        disabled={!canEdit}
                        canMoveUp={index > 0}
                        canMoveDown={index < layout.blocks.length - 1}
                        onMoveUp={() => moveBlockStep(block.id, -1)}
                        onMoveDown={() => moveBlockStep(block.id, 1)}
                      >
                        <BlockLabelButton
                          label={describeBlock(block)}
                          selected={selectedBlockId === block.id}
                          onClick={() => setSelectedBlockId(block.id)}
                        />
                        {isColumnsBlock(block) ? (
                          <div className="mt-1.5 space-y-1.5">
                            {block.columns.map((column, columnIndex) => (
                              <ColumnDropZone
                                key={column.id}
                                column={column}
                                label={columnLabel(tx, columnIndex, block.columns.length)}
                              >
                                {column.blocks.map((child, childIndex) => (
                                  <li key={child.id}>
                                    <SortableRow
                                      id={child.id}
                                      disabled={!canEdit}
                                      canMoveUp={childIndex > 0}
                                      canMoveDown={childIndex < column.blocks.length - 1}
                                      onMoveUp={() => moveBlockStep(child.id, -1)}
                                      onMoveDown={() => moveBlockStep(child.id, 1)}
                                    >
                                      <BlockLabelButton
                                        label={describeBlock(child)}
                                        selected={selectedBlockId === child.id}
                                        onClick={() => setSelectedBlockId(child.id)}
                                      />
                                    </SortableRow>
                                  </li>
                                ))}
                              </ColumnDropZone>
                            ))}
                          </div>
                        ) : null}
                      </SortableRow>
                    </li>
                  ))}
                </ul>
              </SortableContext>
            </RootDropZone>
          </DndContext>
        </section>

        {/* Block + page settings */}
        <section className="space-y-3" aria-label={t("settings.printTemplates.page")} onFocus={handleSettingsFocus}>
          <div className="rounded-md border border-border p-3 space-y-2">
            <h3 className="text-sm font-semibold">{t("settings.printTemplates.page")}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t("settings.printTemplates.pageSize")}</Label>
                <Select
                  value={layout.page.size}
                  disabled={!canEdit}
                  onValueChange={(value) =>
                    setLayout((prev) => ({ ...prev, page: { ...prev.page, size: value === "A5" ? "A5" : "A4" } }))
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
                      page: { ...prev.page, orientation: value === "landscape" ? "landscape" : "portrait" },
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

          {selectedBlock && selected ? (
            <BlockSettingsPanel
              key={selectedBlock.id}
              block={selectedBlock}
              canEdit={canEdit}
              canMoveUp={selected.index > 0}
              canMoveDown={selectedSiblings ? selected.index < selectedSiblings.length - 1 : false}
              inColumn={selected.containerId !== ROOT_ID}
              columnTargets={columnTargets}
              onMoveUp={() => moveBlockStep(selectedBlock.id, -1)}
              onMoveDown={() => moveBlockStep(selectedBlock.id, 1)}
              onMoveToContainer={(containerId) => moveBlockToContainer(selectedBlock.id, containerId)}
              onChange={(next) => updateBlock(selectedBlock.id, next)}
              onInsertVariable={insertVariable}
              onRemove={() => {
                setLayout((prev) => ({ ...prev, blocks: removeBlockDeep(prev.blocks, selectedBlock.id) }));
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
            <SelectTrigger aria-label={t("settings.printTemplates.previewSource")}>
              <SelectValue placeholder={t("settings.printTemplates.demoData")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEMO_PRINT_SOURCE_ID}>{t("settings.printTemplates.demoData")}</SelectItem>
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
