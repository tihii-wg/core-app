import { useEffect, useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Control, FieldArrayWithId, UseFieldArrayAppend, UseFieldArrayRemove, UseFormGetValues, UseFormSetValue } from "react-hook-form";
import { Controller, useWatch } from "react-hook-form";
import type { InventoryItem, OrderMaterial, OrderMaterialSupplySource } from "../../lib/types";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { AddInventoryItemDialog } from "../inventory/AddInventoryItemDialog";
import InventoryItemCombobox from "../inventory/InventoryItemCombobox";
import { QuickGoodsReceiptDialog } from "../inventory/QuickGoodsReceiptDialog";
import {
  catalogItemToOrderMaterial,
  freeformOrderMaterial,
  isCatalogOrderMaterial,
  parseOrderMaterialQuantity,
  resolveMaterialSupplySource,
} from "../inventory/orderMaterialLine";
import { useGetWarehouses } from "../warehouses/useGetWarehouses";
import { useGetWarehouseStock } from "../warehouses/useGetWarehouseStock";
import { orderLineAmount } from "../services/orderServiceLine";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { defaultIssueWarehouseId, issuableWarehouses, warehouseStockOf } from "./issueWarehouse";
import { useOrderMaterialFreeformSupport } from "./useOrderMaterialFreeformSupport";
import OrderLineWarrantyFields from "./OrderLineWarrantyFields";
import { defaultsForKind, type WorkspaceWarrantyDefaults } from "./warranty";

type MaterialsFormSlice = { materials: OrderMaterial[] };

type OrderMaterialLinesEditorProps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<any>;
  fields: FieldArrayWithId<MaterialsFormSlice, "materials">[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  append: UseFieldArrayAppend<any, "materials">;
  remove: UseFieldArrayRemove;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: UseFormSetValue<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getValues: UseFormGetValues<any>;
  /** Optional; used to surface quantity errors on blur before submit. */
  trigger?: (name?: string | string[]) => Promise<boolean>;
  inventoryItems: InventoryItem[];
  disabled?: boolean;
  /** When true, warranty inputs are read-only (e.g. order already closed). */
  warrantyDisabled?: boolean;
  warrantyDefaults?: WorkspaceWarrantyDefaults;
  isSubmitted?: boolean;
  errors?: {
    root?: { message?: string };
    [index: number]: { quantity?: { message?: string }; itemName?: { message?: string }; price?: { message?: string } } | undefined;
  };
};

function quantityValidationMessage(value: unknown, t: TFunction): true | string {
  if (value === "" || value === null || value === undefined) {
    return t("orders.validation.quantityRequired") as string;
  }
  const number = typeof value === "number" ? value : Number(typeof value === "string" ? value.trim() : value);
  if (!Number.isFinite(number)) {
    return t("orders.validation.quantityRequired") as string;
  }
  if (number <= 0) {
    return t("orders.validation.quantityMin") as string;
  }
  if (!Number.isInteger(number)) {
    return t("orders.validation.quantityInteger") as string;
  }
  return true;
}

type AddMode = "catalog" | "one_time" | "customer";

export default function OrderMaterialLinesEditor({
  control,
  fields,
  append,
  remove,
  setValue,
  getValues,
  trigger,
  inventoryItems,
  disabled = false,
  warrantyDisabled = false,
  warrantyDefaults,
  isSubmitted = false,
  errors,
}: OrderMaterialLinesEditorProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const { data: warehouseRows = [] } = useGetWarehouses();
  const { data: warehouseStock = [] } = useGetWarehouseStock();
  const warehouses = useMemo(() => issuableWarehouses(warehouseRows), [warehouseRows]);
  const { supported: freeformSupported, ready: freeformReady } = useOrderMaterialFreeformSupport();
  const canReceiveStock = warehouses.length > 0;
  const watched = useWatch({ control, name: "materials" });
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialName, setCreateInitialName] = useState("");
  const [receiveItem, setReceiveItem] = useState<InventoryItem | null>(null);
  const [receiveDefaultQty, setReceiveDefaultQty] = useState(1);
  const [addMode, setAddMode] = useState<AddMode>("catalog");
  const [freeName, setFreeName] = useState("");
  const [freePrice, setFreePrice] = useState("0");
  const [freeQty, setFreeQty] = useState("1");
  const [freeError, setFreeError] = useState("");
  const [issueWarehouseId, setIssueWarehouseId] = useState(() => defaultIssueWarehouseId(warehouseRows));

  // Keep default warehouse when the list loads / changes.
  useEffect(() => {
    if (!issueWarehouseId || !warehouses.some((warehouse) => warehouse.id === issueWarehouseId)) {
      setIssueWarehouseId(defaultIssueWarehouseId(warehouses));
    }
  }, [warehouses, issueWarehouseId]);

  const effectiveAddMode: AddMode = !freeformSupported && addMode !== "catalog" ? "catalog" : addMode;

  function adjustQuantity(index: number, delta: number) {
    const current = parseOrderMaterialQuantity(getValues(`materials.${index}.quantity`)) ?? 0;
    const issuedFloor = Number(getValues(`materials.${index}.quantityIssued`) ?? 0);
    const minAllowed = Math.max(1, Number.isFinite(issuedFloor) ? issuedFloor : 0);
    const next = current + delta;
    if (next < minAllowed) return;
    setValue(`materials.${index}.quantity`, next, { shouldDirty: true, shouldValidate: true });
  }

  function handleSelect(item: InventoryItem) {
    if (!issueWarehouseId) return;
    const existingIndex = fields.findIndex((field) => isCatalogOrderMaterial(field) && field.inventoryItemId === item.id);
    if (existingIndex >= 0) {
      const existingWarehouse = String(getValues(`materials.${existingIndex}.warehouseId`) ?? "");
      if (!existingWarehouse) {
        setValue(`materials.${existingIndex}.warehouseId`, issueWarehouseId, { shouldDirty: true });
      }
      adjustQuantity(existingIndex, 1);
      return;
    }
    const warranty = warrantyDefaults ? defaultsForKind(warrantyDefaults, "material") : null;
    append({
      ...catalogItemToOrderMaterial(item, 1, issueWarehouseId),
      ...(warranty
        ? { warrantyMonths: warranty.durationMonths, warrantyKm: warranty.mileageLimit, warrantyDays: null }
        : {}),
    });
  }

  function handleCreated(item: InventoryItem) {
    handleSelect(item);
    if (canReceiveStock) {
      setReceiveDefaultQty(1);
      setReceiveItem(item);
    }
  }

  function openReceiveForLine(item: InventoryItem, quantity: number) {
    if (!canReceiveStock || disabled) return;
    setReceiveDefaultQty(quantity > 0 ? quantity : 1);
    setReceiveItem(item);
  }

  function handleCreateRequest(searchQuery: string) {
    setCreateInitialName(searchQuery);
    setCreateOpen(true);
  }

  function handleAddOneTimeRequest(searchQuery: string) {
    if (!freeformSupported) return;
    setAddMode("one_time");
    setFreeName(searchQuery);
    setFreePrice("0");
    setFreeQty("1");
    setFreeError("");
  }

  function addFreeformLine(supplySource: Exclude<OrderMaterialSupplySource, "catalog">) {
    setFreeError("");
    try {
      const warranty = warrantyDefaults ? defaultsForKind(warrantyDefaults, "material") : null;
      append({
        ...freeformOrderMaterial({
          itemName: freeName,
          price: Number(freePrice),
          quantity: Number(freeQty),
          supplySource,
        }),
        ...(warranty
          ? { warrantyMonths: warranty.durationMonths, warrantyKm: warranty.mileageLimit, warrantyDays: null }
          : {}),
      });
      setFreeName("");
      setFreePrice("0");
      setFreeQty("1");
    } catch {
      setFreeError(t("orders.form.freeformInvalid"));
    }
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="order-material">{t("orders.form.materialsSection")}</Label>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("orders.form.materialSourceAria")}>
        {(
          [
            ["catalog", "orders.form.materialSourceCatalog"],
            ["one_time", "orders.form.materialSourceOneTime"],
            ["customer", "orders.form.materialSourceCustomer"],
          ] as const
        )
          .filter(([mode]) => mode === "catalog" || freeformSupported)
          .map(([mode, labelKey]) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={effectiveAddMode === mode ? "default" : "outline"}
              disabled={disabled || (mode !== "catalog" && !freeformReady)}
              onClick={() => {
                setAddMode(mode);
                setFreeError("");
              }}
            >
              {t(labelKey)}
            </Button>
          ))}
      </div>

      {freeformReady && !freeformSupported ? (
        <p className="text-xs text-muted-foreground">{t("orders.errors.freeformMaterialsUnsupported")}</p>
      ) : null}

      {effectiveAddMode === "catalog" ? (
        <>
          {warehouses.length === 0 ? (
            <p className="text-xs text-destructive">{t("orders.warehouse.noActiveWarehouse")}</p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="order-material-issue-warehouse">{t("orders.form.issueWarehouseLabel")}</Label>
              <Select
                value={issueWarehouseId}
                onValueChange={setIssueWarehouseId}
                disabled={disabled}
              >
                <SelectTrigger id="order-material-issue-warehouse" aria-label={t("orders.form.issueWarehouseLabel")}>
                  <SelectValue placeholder={t("orders.warehouse.warehousePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("orders.form.immediateIssueHint")}</p>
            </div>
          )}
          <InventoryItemCombobox
            items={inventoryItems}
            onSelect={disabled || warehouses.length === 0 || !issueWarehouseId ? undefined : handleSelect}
            onCreateRequest={disabled || warehouses.length === 0 ? undefined : handleCreateRequest}
            onAddOneTimeRequest={disabled || !freeformSupported ? undefined : handleAddOneTimeRequest}
            errors={!!errors?.root}
          />
          <p className="text-xs text-muted-foreground">{t("orders.form.materialsImmediateHint")}</p>
          <AddInventoryItemDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            initialName={createInitialName}
            onCreated={handleCreated}
          />
        </>
      ) : (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-xs text-muted-foreground">
            {effectiveAddMode === "customer" ? t("orders.form.customerPartHint") : t("orders.form.oneTimePartHint")}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="free-material-name">{t("orders.form.freeformName")}</Label>
              <Input
                id="free-material-name"
                value={freeName}
                disabled={disabled}
                onChange={(event) => setFreeName(event.target.value)}
                placeholder={t("orders.form.freeformNamePlaceholder")}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="free-material-qty">{t("orders.form.quantityLabel")}</Label>
              <Input
                id="free-material-qty"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={freeQty}
                disabled={disabled}
                onChange={(event) => setFreeQty(event.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="free-material-price">
                {effectiveAddMode === "customer" ? t("orders.form.customerPartPrice") : t("orders.form.oneTimePartPrice")}
              </Label>
              <Input
                id="free-material-price"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={freePrice}
                disabled={disabled}
                onChange={(event) => setFreePrice(event.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                disabled={disabled}
                onClick={() => addFreeformLine(effectiveAddMode === "customer" ? "customer" : "one_time")}
              >
                {t("orders.form.addFreeformLine")}
              </Button>
            </div>
          </div>
          {freeError ? <p className="text-xs text-destructive">{freeError}</p> : null}
        </div>
      )}

      {errors?.root?.message && <p className="text-xs text-destructive">{errors.root.message}</p>}

      {fields.length > 0 && (
        <div className="space-y-2">
          {fields.map((field, index) => {
            const line = watched?.[index];
            const unitPrice = line?.price ?? field.price ?? 0;
            const parsedQty = parseOrderMaterialQuantity(line?.quantity ?? field.quantity);
            const catalog = isCatalogOrderMaterial(line ?? field);
            const source = resolveMaterialSupplySource(line ?? field);
            const issuedQty = Number(line?.quantityIssued ?? field.quantityIssued ?? 0);
            const returnedQty = Number(line?.quantityReturned ?? field.quantityReturned ?? 0);
            const outstanding = Math.max(0, issuedQty - returnedQty);
            const hasWarehouseHistory = issuedQty > 0 || returnedQty > 0;
            const freeformIdentityLocked = !catalog && hasWarehouseHistory;
            const minQuantity = Math.max(1, outstanding > 0 ? outstanding : issuedQty);
            const lineWarehouseId = String(line?.warehouseId ?? field.warehouseId ?? issueWarehouseId ?? "");
            const itemId = String(line?.inventoryItemId ?? field.inventoryItemId ?? "");
            const warehouseAvailable =
              catalog && lineWarehouseId && itemId ? warehouseStockOf(warehouseStock, lineWarehouseId, itemId) : undefined;
            const warehouseName = warehouses.find((warehouse) => warehouse.id === lineWarehouseId)?.name;
            const quantityError = errors?.[index]?.quantity;
            const quantityInputId = `order-material-qty-${field.id}`;
            const sourceLabel =
              source === "customer"
                ? t("orders.form.materialSourceCustomer")
                : source === "one_time"
                  ? t("orders.form.materialSourceOneTime")
                  : t("orders.form.materialSourceCatalog");

            return (
              <div key={field.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    {catalog || freeformIdentityLocked ? (
                      <p className="font-medium [overflow-wrap:anywhere]">{line?.itemName ?? field.itemName}</p>
                    ) : (
                      <Controller
                        name={`materials.${index}.itemName`}
                        control={control}
                        rules={{
                          validate: (value) => (typeof value === "string" && value.trim().length > 0) || t("orders.form.freeformNameRequired"),
                        }}
                        render={({ field: nameField }) => (
                          <Input
                            {...nameField}
                            disabled={disabled}
                            aria-label={t("orders.form.freeformName")}
                            className={errors?.[index]?.itemName ? "border-destructive" : ""}
                          />
                        )}
                      />
                    )}
                    <p className="text-[12px] text-muted-foreground">{sourceLabel}</p>
                    {catalog || freeformIdentityLocked ? (
                      <p className="text-[13px] text-muted-foreground">
                        {t("orders.detail.price")}: <span className="tabular-nums">{formatMoney(unitPrice)}</span>
                      </p>
                    ) : (
                      <Controller
                        name={`materials.${index}.price`}
                        control={control}
                        rules={{
                          validate: (value) => {
                            const number = typeof value === "number" ? value : Number(value);
                            if (!Number.isFinite(number) || number < 0) return t("orders.form.freeformPriceInvalid") as string;
                            return true;
                          },
                        }}
                        render={({ field: priceField }) => (
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            disabled={disabled}
                            aria-label={t("orders.detail.price")}
                            className={`h-8 w-28 tabular-nums ${errors?.[index]?.price ? "border-destructive" : ""}`}
                            value={priceField.value === "" || priceField.value == null ? "" : priceField.value}
                            onChange={(event) => {
                              const raw = event.target.value;
                              if (raw === "") priceField.onChange("");
                              else {
                                const asNumber = Number(raw);
                                priceField.onChange(Number.isFinite(asNumber) ? asNumber : raw);
                              }
                            }}
                            onBlur={priceField.onBlur}
                          />
                        )}
                      />
                    )}
                    {freeformIdentityLocked ? (
                      <p className="text-[12px] text-muted-foreground">{t("orders.form.freeformHistoryLocked")}</p>
                    ) : null}
                    {catalog ? (
                      <div className="space-y-1">
                        <Controller
                          name={`materials.${index}.warehouseId`}
                          control={control}
                          rules={{
                            validate: (value) =>
                              (typeof value === "string" && value.trim().length > 0) || (t("orders.warehouse.warehouseRequired") as string),
                          }}
                          render={({ field: warehouseField }) => (
                            <Select
                              value={warehouseField.value || ""}
                              onValueChange={warehouseField.onChange}
                              disabled={disabled || warehouses.length === 0 || hasWarehouseHistory}
                            >
                              <SelectTrigger
                                aria-label={t("orders.form.issueWarehouseLabel")}
                                className="h-8 max-w-xs"
                              >
                                <SelectValue placeholder={t("orders.warehouse.warehousePlaceholder")} />
                              </SelectTrigger>
                              <SelectContent>
                                {warehouses.map((warehouse) => (
                                  <SelectItem key={warehouse.id} value={warehouse.id}>
                                    {warehouse.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                        {warehouseAvailable != null ? (
                          <p className="text-[13px] text-muted-foreground">
                            {t("orders.warehouse.warehouseStock", { count: warehouseAvailable })}
                            {warehouseName ? ` · ${warehouseName}` : ""}
                          </p>
                        ) : null}
                        {hasWarehouseHistory ? (
                          <p className="text-[12px] text-muted-foreground">
                            {t("orders.form.issuedSummary", { issued: issuedQty, returned: returnedQty, outstanding })}
                          </p>
                        ) : (
                          <p className="text-[12px] text-muted-foreground">{t("orders.form.willDeductOnSave")}</p>
                        )}
                      </div>
                    ) : null}
                    {catalog && canReceiveStock ? (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto px-0 text-xs"
                        disabled={disabled}
                        onClick={() => {
                          const catalogItem = inventoryItems.find(
                            (entry) => entry.id === (line?.inventoryItemId ?? field.inventoryItemId),
                          );
                          if (catalogItem) openReceiveForLine(catalogItem, parsedQty ?? 1);
                        }}
                      >
                        {t("orders.form.receiveStock")}
                      </Button>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled || outstanding > 0}
                    title={outstanding > 0 ? (t("orders.form.returnBeforeRemove") as string) : undefined}
                    onClick={() => remove(index)}
                    aria-label={t("orders.form.removeMaterial", { name: line?.itemName ?? field.itemName })}
                  >
                    {t("orders.form.remove")}
                  </Button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">{t("orders.form.quantityLabel")}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      disabled={disabled || parsedQty == null || parsedQty <= minQuantity}
                      onClick={() => adjustQuantity(index, -1)}
                      aria-label={t("orders.form.decreaseQuantity", { name: line?.itemName ?? field.itemName })}
                    >
                      <Minus />
                    </Button>
                    <Controller
                      name={`materials.${index}.quantity`}
                      control={control}
                      rules={{
                        validate: (value) => {
                          const base = quantityValidationMessage(value, t);
                          if (base !== true) return base;
                          const number = typeof value === "number" ? value : Number(value);
                          if (number < minQuantity) return t("orders.errors.cannotReduceBelowIssued") as string;
                          if (catalog && lineWarehouseId && itemId && warehouseAvailable != null) {
                            const alreadyIssued = outstanding;
                            const needFromWarehouse = Math.max(0, number - alreadyIssued);
                            if (needFromWarehouse > warehouseAvailable) {
                              return t("orders.errors.insufficientWarehouseStockDetail", {
                                material: line?.itemName ?? field.itemName,
                                requested: needFromWarehouse,
                                available: warehouseAvailable,
                                warehouse: warehouseName ?? "",
                              }) as string;
                            }
                          }
                          return true;
                        },
                      }}
                      render={({ field: quantityField }) => (
                        <Input
                          id={quantityInputId}
                          type="number"
                          min={minQuantity}
                          step={1}
                          inputMode="numeric"
                          disabled={disabled}
                          aria-label={t("orders.form.quantityForMaterial", { name: line?.itemName ?? field.itemName })}
                          className={`h-8 w-16 px-1 text-center tabular-nums ${quantityError ? "border-destructive" : ""}`}
                          value={quantityField.value === "" || quantityField.value == null ? "" : quantityField.value}
                          onChange={(event) => {
                            const raw = event.target.value;
                            if (raw === "") {
                              quantityField.onChange("");
                            } else {
                              const asNumber = Number(raw);
                              quantityField.onChange(Number.isFinite(asNumber) ? asNumber : raw);
                            }
                            if (isSubmitted) void trigger?.(`materials.${index}.quantity`);
                          }}
                          onBlur={() => {
                            quantityField.onBlur();
                            void trigger?.(`materials.${index}.quantity`);
                          }}
                        />
                      )}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      disabled={disabled}
                      onClick={() => adjustQuantity(index, 1)}
                      aria-label={t("orders.form.increaseQuantity", { name: line?.itemName ?? field.itemName })}
                    >
                      <Plus />
                    </Button>
                  </div>
                  <p className="text-sm font-medium tabular-nums">
                    {t("orders.detail.amount")}: {formatMoney(orderLineAmount({ price: unitPrice, quantity: parsedQty ?? 0 }))}
                  </p>
                </div>
                {quantityError?.message && <p className="text-xs text-destructive">{quantityError.message}</p>}
                {catalog && outstanding > 0 && parsedQty != null && parsedQty < outstanding ? (
                  <p className="text-xs text-destructive">{t("orders.errors.returnBeforeReduce")}</p>
                ) : null}
                <OrderLineWarrantyFields
                  idPrefix={`edit-material-${index}`}
                  months={line?.warrantyMonths}
                  days={line?.warrantyDays}
                  km={line?.warrantyKm}
                  disabled={disabled || warrantyDisabled}
                  onChange={({ warrantyMonths, warrantyDays, warrantyKm }) => {
                    setValue(`materials.${index}.warrantyMonths`, warrantyMonths, { shouldDirty: true });
                    setValue(`materials.${index}.warrantyDays`, warrantyDays, { shouldDirty: true });
                    setValue(`materials.${index}.warrantyKm`, warrantyKm, { shouldDirty: true });
                  }}
                />
              </div>
            );
          })}
        </div>
      )}

      <QuickGoodsReceiptDialog
        open={Boolean(receiveItem)}
        onOpenChange={(next) => {
          if (!next) setReceiveItem(null);
        }}
        item={receiveItem}
        defaultQuantity={receiveDefaultQty}
      />
    </div>
  );
}
