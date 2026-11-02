import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Control, FieldArrayWithId, UseFieldArrayAppend, UseFieldArrayRemove, UseFormGetValues, UseFormSetValue } from "react-hook-form";
import { Controller, useWatch } from "react-hook-form";
import type { InventoryItem, OrderMaterial, OrderMaterialSupplySource } from "../../lib/types";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { AddInventoryItemDialog } from "../inventory/AddInventoryItemDialog";
import InventoryItemCombobox from "../inventory/InventoryItemCombobox";
import {
  catalogItemToOrderMaterial,
  freeformOrderMaterial,
  isCatalogOrderMaterial,
  parseOrderMaterialQuantity,
  resolveMaterialSupplySource,
} from "../inventory/orderMaterialLine";
import { orderLineAmount } from "../services/orderServiceLine";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";

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
  isSubmitted = false,
  errors,
}: OrderMaterialLinesEditorProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const watched = useWatch({ control, name: "materials" });
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialName, setCreateInitialName] = useState("");
  const [addMode, setAddMode] = useState<AddMode>("catalog");
  const [freeName, setFreeName] = useState("");
  const [freePrice, setFreePrice] = useState("0");
  const [freeQty, setFreeQty] = useState("1");
  const [freeError, setFreeError] = useState("");

  function adjustQuantity(index: number, delta: number) {
    const current = parseOrderMaterialQuantity(getValues(`materials.${index}.quantity`)) ?? 0;
    const next = current + delta;
    if (next < 1) return;
    setValue(`materials.${index}.quantity`, next, { shouldDirty: true, shouldValidate: true });
  }

  function handleSelect(item: InventoryItem) {
    const existingIndex = fields.findIndex((field) => isCatalogOrderMaterial(field) && field.inventoryItemId === item.id);
    if (existingIndex >= 0) {
      adjustQuantity(existingIndex, 1);
      return;
    }
    append(catalogItemToOrderMaterial(item, 1));
  }

  function handleCreateRequest(searchQuery: string) {
    setCreateInitialName(searchQuery);
    setCreateOpen(true);
  }

  function handleAddOneTimeRequest(searchQuery: string) {
    setAddMode("one_time");
    setFreeName(searchQuery);
    setFreePrice("0");
    setFreeQty("1");
    setFreeError("");
  }

  function addFreeformLine(supplySource: Exclude<OrderMaterialSupplySource, "catalog">) {
    setFreeError("");
    try {
      append(
        freeformOrderMaterial({
          itemName: freeName,
          price: Number(freePrice),
          quantity: Number(freeQty),
          supplySource,
        }),
      );
      setFreeName("");
      setFreePrice(supplySource === "customer" ? "0" : "0");
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
        ).map(([mode, labelKey]) => (
          <Button
            key={mode}
            type="button"
            size="sm"
            variant={addMode === mode ? "default" : "outline"}
            disabled={disabled}
            onClick={() => {
              setAddMode(mode);
              setFreeError("");
            }}
          >
            {t(labelKey)}
          </Button>
        ))}
      </div>

      {addMode === "catalog" ? (
        <>
          <InventoryItemCombobox
            items={inventoryItems}
            onSelect={handleSelect}
            onCreateRequest={disabled ? undefined : handleCreateRequest}
            onAddOneTimeRequest={disabled ? undefined : handleAddOneTimeRequest}
            errors={!!errors?.root}
          />
          <p className="text-xs text-muted-foreground">{t("orders.form.materialsRequestHint")}</p>
          <AddInventoryItemDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            initialName={createInitialName}
            onCreated={handleSelect}
          />
        </>
      ) : (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-xs text-muted-foreground">
            {addMode === "customer" ? t("orders.form.customerPartHint") : t("orders.form.oneTimePartHint")}
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
                {addMode === "customer" ? t("orders.form.customerPartPrice") : t("orders.form.oneTimePartPrice")}
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
                onClick={() => addFreeformLine(addMode === "customer" ? "customer" : "one_time")}
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
            const stock = catalog ? inventoryItems.find((item) => item.id === (line?.inventoryItemId ?? field.inventoryItemId))?.quantity : undefined;
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
                    {catalog ? (
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
                    {catalog ? (
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
                    {stock != null && (
                      <p className="text-[13px] text-muted-foreground">
                        {t("orders.form.availableStock")}: <span className="tabular-nums">{stock}</span>
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
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
                      disabled={disabled || (parsedQty != null && parsedQty <= 1) || parsedQty == null}
                      onClick={() => adjustQuantity(index, -1)}
                      aria-label={t("orders.form.decreaseQuantity", { name: line?.itemName ?? field.itemName })}
                    >
                      <Minus />
                    </Button>
                    <Controller
                      name={`materials.${index}.quantity`}
                      control={control}
                      rules={{
                        validate: (value) => quantityValidationMessage(value, t),
                      }}
                      render={({ field: quantityField }) => (
                        <Input
                          id={quantityInputId}
                          type="number"
                          min={1}
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
