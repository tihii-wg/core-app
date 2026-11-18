import { useTranslation } from "react-i18next";
import { AlignCenter, AlignLeft, AlignRight, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import type { TableColumnKey, TableSource, TotalsRow, TotalsRowKey } from "../layout";
import type { SignaturesCanvasElement, TableCanvasElement, TotalsCanvasElement } from "./types";
import { Button } from "../../../ui/Button";
import { Input } from "../../../ui/Input";
import { Label } from "../../../ui/Label";
import { Switch } from "../../../ui/Switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../ui/Select";

/**
 * "What does this block print" settings for the canvas designer: table source / header / columns,
 * totals rows, signature captions. Everything here changes only the data the block pulls in;
 * colours and geometry stay in the generic properties above.
 */

const ORDER_SOURCES: TableSource[] = ["services", "materials", "allLines"];
const INVOICE_SOURCES: TableSource[] = ["invoiceLines", "invoiceWorks", "invoiceMaterials", "prepaymentLine", "balanceLine"];

const SOURCE_FALLBACK: Record<TableSource, string> = {
  services: "Services",
  materials: "Materials",
  allLines: "All lines",
  invoiceLines: "Invoice lines",
  invoiceWorks: "Invoice works",
  invoiceMaterials: "Invoice materials",
  prepaymentLine: "Prepayment line",
  balanceLine: "Balance due line",
};

export const ALL_TABLE_COLUMN_KEYS: TableColumnKey[] = [
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
  "comment",
];

export const ALL_TOTALS_KEYS: TotalsRowKey[] = [
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
  "paidWords",
  "remainingWords",
];

function move<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** Element columns first (their order), then every other column key as a disabled row the user can switch on. */
export function tableColumnsWithAllKeys(
  columns: TableCanvasElement["columns"],
  defaultLabel: (key: TableColumnKey) => string,
): TableCanvasElement["columns"] {
  const present = new Set(columns.map((column) => column.key));
  return [
    ...columns,
    ...ALL_TABLE_COLUMN_KEYS.filter((key) => !present.has(key)).map((key) => ({
      key,
      label: defaultLabel(key),
      enabled: false,
    })),
  ];
}

/** Element rows first (their order), then every other totals key as a disabled row. */
export function totalsRowsWithAllKeys(rows: TotalsRow[], defaultLabel: (key: TotalsRowKey) => string): TotalsRow[] {
  const present = new Set(rows.map((row) => row.key));
  return [
    ...rows,
    ...ALL_TOTALS_KEYS.filter((key) => !present.has(key)).map((key) => ({ key, label: defaultLabel(key), enabled: false })),
  ];
}

type RowControlsProps = {
  index: number;
  count: number;
  disabled?: boolean;
  onMove: (to: number) => void;
};

function RowMoveButtons({ index, count, disabled, onMove }: RowControlsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={disabled || index === 0}
        aria-label={t("settings.printTemplates.canvas.block.moveUp")}
        onClick={() => onMove(index - 1)}
      >
        <ChevronUp className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={disabled || index === count - 1}
        aria-label={t("settings.printTemplates.canvas.block.moveDown")}
        onClick={() => onMove(index + 1)}
      >
        <ChevronDown className="size-3.5" />
      </Button>
    </div>
  );
}

export function TableBlockSettings({
  element,
  isInvoice,
  disabled,
  onChange,
}: {
  element: TableCanvasElement;
  isInvoice: boolean;
  disabled?: boolean;
  onChange: (next: TableCanvasElement) => void;
}) {
  const { t } = useTranslation();
  const sources = isInvoice ? INVOICE_SOURCES : ORDER_SOURCES;
  const sourceOptions = sources.includes(element.source) ? sources : [element.source, ...sources];
  const columns = tableColumnsWithAllKeys(element.columns, (key) =>
    t(`settings.printTemplates.columnKeys.${key}` as "settings.printTemplates.columnKeys.name"),
  );
  const setColumns = (next: TableCanvasElement["columns"]) => onChange({ ...element, columns: next });

  return (
    <div className="space-y-3 border-t border-border pt-3" data-testid="canvas-table-settings">
      <p className="text-sm font-medium">{t("settings.printTemplates.canvas.block.title")}</p>
      <div className="space-y-1">
        <Label className="text-xs">{t("settings.printTemplates.canvas.block.tableSource")}</Label>
        <Select
          value={element.source}
          disabled={disabled}
          onValueChange={(value) => {
            const source = sourceOptions.find((item) => item === value);
            if (source) onChange({ ...element, source });
          }}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sourceOptions.map((source) => (
              <SelectItem key={source} value={source}>
                {t(`settings.printTemplates.sources.${source}` as "settings.printTemplates.sources.services", {
                  defaultValue: SOURCE_FALLBACK[source],
                })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{t("settings.printTemplates.canvas.block.showHeader")}</Label>
        <Switch
          checked={element.showHeader !== false}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ ...element, showHeader: checked ? undefined : false })}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{t("settings.printTemplates.canvas.block.showTotalsRow")}</Label>
        <Switch
          checked={element.showTotalsRow}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ ...element, showTotalsRow: checked })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t("settings.printTemplates.canvas.block.borders")}</Label>
        <Select
          value={element.borders}
          disabled={disabled}
          onValueChange={(value) => {
            if (value === "all" || value === "horizontal" || value === "none") onChange({ ...element, borders: value });
          }}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("settings.printTemplates.canvas.block.bordersAll")}</SelectItem>
            <SelectItem value="horizontal">{t("settings.printTemplates.canvas.block.bordersHorizontal")}</SelectItem>
            <SelectItem value="none">{t("settings.printTemplates.canvas.block.bordersNone")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">{t("settings.printTemplates.canvas.block.columns")}</Label>
        <ul className="space-y-1.5">
          {columns.map((column, index) => (
            <li key={column.key} className="space-y-1.5 rounded-md border border-border p-2">
              <div className="flex items-center gap-1.5">
                <Switch
                  checked={column.enabled}
                  disabled={disabled}
                  aria-label={t("settings.printTemplates.enabled")}
                  onCheckedChange={(checked) =>
                    setColumns(columns.map((item) => (item.key === column.key ? { ...item, enabled: checked } : item)))
                  }
                />
                <Input
                  className="h-8 min-w-0 flex-1"
                  value={column.label}
                  disabled={disabled}
                  aria-label={t("settings.printTemplates.columnLabel")}
                  onChange={(event) =>
                    setColumns(
                      columns.map((item) => (item.key === column.key ? { ...item, label: event.target.value } : item)),
                    )
                  }
                />
                <RowMoveButtons
                  index={index}
                  count={columns.length}
                  disabled={disabled}
                  onMove={(to) => setColumns(move(columns, index, to))}
                />
              </div>
              {column.enabled ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    className="h-7 w-20"
                    disabled={disabled}
                    placeholder={t("settings.printTemplates.canvas.block.columnWidth")}
                    aria-label={t("settings.printTemplates.canvas.block.columnWidth")}
                    value={column.widthPercent ?? ""}
                    onChange={(event) => {
                      const raw = Number(event.target.value);
                      const widthPercent = Number.isFinite(raw) && raw > 0 ? Math.min(100, raw) : undefined;
                      setColumns(
                        columns.map((item) => {
                          if (item.key !== column.key) return item;
                          const { widthPercent: _old, ...rest } = item;
                          void _old;
                          return widthPercent ? { ...rest, widthPercent } : rest;
                        }),
                      );
                    }}
                  />
                  <span className="text-[11px] text-muted-foreground">%</span>
                  <div className="ml-auto flex gap-0.5" aria-label={t("settings.printTemplates.canvas.block.columnAlign")}>
                    {(["left", "center", "right"] as const).map((align) => (
                      <Button
                        key={align}
                        type="button"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        variant={column.align === align ? "default" : "outline"}
                        disabled={disabled}
                        onClick={() =>
                          setColumns(
                            columns.map((item) =>
                              item.key === column.key ? { ...item, align: item.align === align ? undefined : align } : item,
                            ),
                          )
                        }
                      >
                        {align === "left" ? (
                          <AlignLeft className="size-3.5" />
                        ) : align === "center" ? (
                          <AlignCenter className="size-3.5" />
                        ) : (
                          <AlignRight className="size-3.5" />
                        )}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function TotalsBlockSettings({
  element,
  disabled,
  onChange,
}: {
  element: TotalsCanvasElement;
  disabled?: boolean;
  onChange: (next: TotalsCanvasElement) => void;
}) {
  const { t } = useTranslation();
  const rows = totalsRowsWithAllKeys(element.rows, (key) =>
    t(`settings.printTemplates.canvas.totalsKeys.${key}` as "settings.printTemplates.canvas.totalsKeys.total"),
  );
  const setRows = (next: TotalsRow[]) => onChange({ ...element, rows: next });
  return (
    <div className="space-y-2 border-t border-border pt-3" data-testid="canvas-totals-settings">
      <p className="text-sm font-medium">{t("settings.printTemplates.canvas.block.totalsRows")}</p>
      <ul className="space-y-1.5">
        {rows.map((row, index) => (
          <li key={row.key} className="space-y-1 rounded-md border border-border p-2">
            <div className="flex items-center gap-1.5">
              <Switch
                checked={row.enabled}
                disabled={disabled}
                aria-label={t("settings.printTemplates.enabled")}
                onCheckedChange={(checked) =>
                  setRows(rows.map((item) => (item.key === row.key ? { ...item, enabled: checked } : item)))
                }
              />
              <Input
                className="h-8 min-w-0 flex-1"
                value={row.label}
                disabled={disabled}
                onChange={(event) =>
                  setRows(rows.map((item) => (item.key === row.key ? { ...item, label: event.target.value } : item)))
                }
              />
              <RowMoveButtons index={index} count={rows.length} disabled={disabled} onMove={(to) => setRows(move(rows, index, to))} />
            </div>
            <p className="pl-11 text-[11px] text-muted-foreground">
              {t(`settings.printTemplates.canvas.totalsKeys.${row.key}` as "settings.printTemplates.canvas.totalsKeys.total")}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SignaturesBlockSettings({
  element,
  disabled,
  onChange,
}: {
  element: SignaturesCanvasElement;
  disabled?: boolean;
  onChange: (next: SignaturesCanvasElement) => void;
}) {
  const { t } = useTranslation();
  const labels = element.labels;
  return (
    <div className="space-y-2 border-t border-border pt-3" data-testid="canvas-signatures-settings">
      <p className="text-sm font-medium">{t("settings.printTemplates.canvas.block.signatureLabels")}</p>
      <ul className="space-y-1.5">
        {labels.map((label, index) => (
          <li key={index} className="flex items-center gap-1.5">
            <Input
              className="h-8 min-w-0 flex-1"
              value={label}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...element, labels: labels.map((item, i) => (i === index ? event.target.value : item)) })
              }
            />
            <RowMoveButtons
              index={index}
              count={labels.length}
              disabled={disabled}
              onMove={(to) => onChange({ ...element, labels: move(labels, index, to) })}
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled || labels.length <= 1}
              aria-label={t("settings.printTemplates.canvas.block.remove")}
              onClick={() => onChange({ ...element, labels: labels.filter((_, i) => i !== index) })}
            >
              <X className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || labels.length >= 4}
        onClick={() =>
          onChange({ ...element, labels: [...labels, t("settings.printTemplates.canvas.defaults.signature")] })
        }
      >
        <Plus className="size-3.5" />
        {t("settings.printTemplates.canvas.block.addSignature")}
      </Button>
      <div className="space-y-1">
        <Label className="text-xs">{t("settings.printTemplates.canvas.block.dateLabel")}</Label>
        <Input
          className="h-8"
          value={element.dateLabel ?? ""}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value;
            const { dateLabel: _old, ...rest } = element;
            void _old;
            onChange(value ? { ...rest, dateLabel: value } : rest);
          }}
        />
      </div>
    </div>
  );
}
