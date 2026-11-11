import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { OrderMaterial } from "../../lib/types";
import { formatQuantity, parseQuantity } from "../../lib/quantity";
import { cn } from "../../lib/utils";
import { isCatalogOrderMaterial } from "../inventory/orderMaterialLine";
import { OrderLineInlineNumberEditor } from "./OrderLineInlineNumberEditor";
import {
  InsufficientMaterialStockError,
  type InsufficientMaterialStock,
} from "./updateOrderMaterialLine";
import { isMaterialPriceBelowPurchase } from "./materialLineStockDelta";
import { parseOrderServiceLinePrice } from "./updateOrderServiceLine";
import { languageFromPath } from "../../i18n/languages";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export type MaterialLineInlineField = "quantity" | "price";

export type MaterialLineInlineEditTarget = {
  lineId: string;
  field: MaterialLineInlineField;
};

type OrderMaterialLineInlineCellsProps = {
  line: OrderMaterial;
  editable: boolean;
  editing: MaterialLineInlineEditTarget | null;
  formatMoney: (value: number) => string;
  locale: string;
  amountNode: ReactNode;
  saving: boolean;
  /** Catalog purchase price when the viewer may see cost. */
  purchasePrice?: number | null;
  warehouseName?: string;
  /** On-hand stock on the line's warehouse (catalog only). */
  warehouseOnHand?: number | null;
  /** Max quantity allowed for this line (on-hand + outstanding − sibling claims). */
  maxQuantity?: number | null;
  onRequestEdit: (field: MaterialLineInlineField) => void;
  onCancel: () => void;
  onSaved: () => void;
  onSaveField: (field: MaterialLineInlineField, value: string) => Promise<void>;
  onEditorClosed: () => void;
  /** Apply "set to max available" from an insufficient-stock warning. */
  onSetQuantityToMax?: (max: number) => void;
};

export default function OrderMaterialLineInlineCells({
  line,
  editable,
  editing,
  formatMoney,
  locale,
  amountNode,
  saving,
  purchasePrice,
  warehouseName,
  warehouseOnHand,
  maxQuantity,
  onRequestEdit,
  onCancel,
  onSaved,
  onSaveField,
  onEditorClosed,
  onSetQuantityToMax,
}: OrderMaterialLineInlineCellsProps) {
  const { t } = useTranslation();
  const canEditLine = editable && Boolean(line.id?.trim());
  const isEditing = (field: MaterialLineInlineField) =>
    Boolean(canEditLine && editing && editing.lineId === line.id && editing.field === field);
  const catalog = isCatalogOrderMaterial(line);
  const [draftPrice, setDraftPrice] = useState<string | null>(null);
  const [stockHint, setStockHint] = useState<InsufficientMaterialStock | null>(null);
  const [draftQty, setDraftQty] = useState<string | null>(null);

  const livePrice = useMemo(() => {
    if (draftPrice == null) return Number(line.price);
    const parsed = parseOrderServiceLinePrice(draftPrice);
    return parsed === "invalid" ? Number(line.price) : parsed;
  }, [draftPrice, line.price]);

  const belowCost = catalog && isMaterialPriceBelowPurchase(livePrice, purchasePrice ?? null);

  const belowCostNode =
    belowCost && purchasePrice != null ? (
      <div role="alert" className="mt-0.5 text-left text-[11px] font-medium text-destructive" data-testid="material-price-below-cost">
        {t("orders.form.priceBelowPurchase", { purchase: formatMoney(purchasePrice) })}
      </div>
    ) : null;

  return (
    <>
      <td className="px-2 py-2 align-top text-right tabular-nums text-muted-foreground sm:px-3">
        {isEditing("quantity") ? (
          <OrderLineInlineNumberEditor
            label={t("orders.detail.quantity")}
            initial={String(line.quantity ?? "")}
            testId={`material-line-qty-editor-${line.id}`}
            saving={saving}
            selectOnFocus
            parse={(raw) => {
              const parsed = parseQuantity(raw);
              if (parsed === "required") return t("orders.validation.quantityRequired");
              if (parsed === "min") return t("orders.validation.quantityMin");
              if (parsed === "maxDecimals") return t("orders.validation.quantityMaxDecimals");
              if (catalog && maxQuantity != null && parsed > maxQuantity + 1e-9) {
                return t("orders.materialInline.maxForLine", {
                  max: formatQuantity(maxQuantity, locale),
                  onHand: formatQuantity(warehouseOnHand ?? 0, locale),
                  warehouse: warehouseName?.trim() || "—",
                });
              }
              return { value: String(parsed) };
            }}
            onDraftChange={setDraftQty}
            onCancel={() => {
              setStockHint(null);
              setDraftQty(null);
              onCancel();
              onEditorClosed();
            }}
            onSave={async (raw) => {
              setStockHint(null);
              try {
                await onSaveField("quantity", raw);
                onSaved();
              } catch (err) {
                if (err instanceof InsufficientMaterialStockError) {
                  setStockHint(err.detail);
                }
                throw err;
              }
            }}
            onAfterSave={() => {
              setStockHint(null);
              setDraftQty(null);
              onEditorClosed();
            }}
            footer={
              <QuantityStockFooter
                catalog={catalog}
                warehouseOnHand={warehouseOnHand}
                warehouseName={warehouseName}
                maxQuantity={maxQuantity}
                locale={locale}
                stockHint={stockHint}
                draftQty={draftQty}
                onSetQuantityToMax={onSetQuantityToMax}
                onClearHint={() => setStockHint(null)}
              />
            }
          />
        ) : (
          <InlineValueButton
            editable={canEditLine}
            label={t("orders.detail.quantity")}
            testId={`material-line-qty-${line.id ?? "legacy"}`}
            onClick={() => onRequestEdit("quantity")}
            className="w-full text-right"
          >
            {formatQuantity(line.quantity, locale)}
          </InlineValueButton>
        )}
      </td>
      <td className="px-2 py-2 align-top text-right tabular-nums text-muted-foreground sm:px-3">
        {isEditing("price") ? (
          <OrderLineInlineNumberEditor
            label={t("orders.detail.price")}
            initial={String(line.price ?? "")}
            testId={`material-line-price-editor-${line.id}`}
            saving={saving}
            selectOnFocus
            parse={(raw) => {
              const parsed = parseOrderServiceLinePrice(raw);
              if (parsed === "invalid") return t("orders.form.freeformPriceInvalid");
              return { value: String(parsed) };
            }}
            onDraftChange={setDraftPrice}
            onCancel={() => {
              setDraftPrice(null);
              onCancel();
              onEditorClosed();
            }}
            onSave={async (raw) => {
              await onSaveField("price", raw);
              setDraftPrice(null);
              onSaved();
            }}
            onAfterSave={() => {
              setDraftPrice(null);
              onEditorClosed();
            }}
            footer={belowCostNode}
          />
        ) : (
          <div>
            <InlineValueButton
              editable={canEditLine}
              label={t("orders.detail.price")}
              testId={`material-line-price-${line.id ?? "legacy"}`}
              onClick={() => {
                setDraftPrice(null);
                onRequestEdit("price");
              }}
              className="w-full text-right"
            >
              {formatMoney(line.price)}
            </InlineValueButton>
            {belowCostNode}
          </div>
        )}
      </td>
      <td className="px-2 py-2 align-top text-right tabular-nums text-foreground sm:px-3">{amountNode}</td>
    </>
  );
}

function QuantityStockFooter({
  catalog,
  warehouseOnHand,
  warehouseName,
  maxQuantity,
  locale,
  stockHint,
  draftQty,
  onSetQuantityToMax,
  onClearHint,
}: {
  catalog: boolean;
  warehouseOnHand?: number | null;
  warehouseName?: string;
  maxQuantity?: number | null;
  locale: string;
  stockHint: InsufficientMaterialStock | null;
  draftQty: string | null;
  onSetQuantityToMax?: (max: number) => void;
  onClearHint: () => void;
}) {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const draftParsed = draftQty != null ? parseQuantity(draftQty) : null;
  const draftOver =
    catalog &&
    maxQuantity != null &&
    typeof draftParsed === "number" &&
    draftParsed > maxQuantity + 1e-9;
  const showWarning = Boolean(stockHint || draftOver);
  const maxShown = stockHint?.maxQuantity ?? maxQuantity ?? stockHint?.available ?? 0;

  return (
    <div className="space-y-1 text-left text-xs">
      {catalog && warehouseOnHand != null && warehouseName ? (
        <p className="text-muted-foreground" data-testid="material-line-available-hint">
          {t("orders.form.availableOnWarehouse", {
            warehouse: warehouseName,
            count: formatQuantity(warehouseOnHand, locale),
          })}
        </p>
      ) : null}
      {showWarning ? (
        <div className="space-y-1" data-testid="material-line-stock-warning">
          {stockHint && !draftOver ? (
            <p role="alert" className="text-destructive [overflow-wrap:anywhere]">
              {t("orders.form.onlyNAvailableOnWarehouse", {
                available: formatQuantity(maxShown, locale),
                warehouse: stockHint.warehouseName?.trim() || warehouseName || stockHint.warehouseId || "—",
              })}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {onSetQuantityToMax && maxShown > 0 ? (
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                data-testid="material-line-set-max-stock"
                onClick={() => {
                  onSetQuantityToMax(maxShown);
                  onClearHint();
                }}
              >
                {t("orders.form.setToMaximum", { available: formatQuantity(maxShown, locale) })}
              </button>
            ) : null}
            <Link
              to={`/${languageFromPath(window.location.pathname)}/${workspaceId ?? ""}/warehouses`}
              className="font-medium text-primary hover:underline"
              data-testid="material-line-receive-link"
              onClick={(event) => event.stopPropagation()}
            >
              {t("orders.materialInline.receiveToWarehouse")}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InlineValueButton({
  editable,
  label,
  testId,
  onClick,
  className,
  children,
}: {
  editable: boolean;
  label: string;
  testId: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (!editable) {
    return <span className={cn("block min-w-0 [overflow-wrap:anywhere]", className)}>{children}</span>;
  }
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={t("orders.detail.editField", { field: label })}
      className={cn(
        "-mx-1 min-w-0 cursor-text rounded-md px-1 py-0.5 outline-none transition-colors",
        "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/35",
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
