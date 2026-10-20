import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Control, FieldArrayWithId, UseFieldArrayAppend, UseFieldArrayRemove, UseFormGetValues, UseFormSetValue } from "react-hook-form";
import { Controller, useWatch } from "react-hook-form";
import type { InventoryItem, OrderMaterial } from "../../lib/types";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { AddInventoryItemDialog } from "../inventory/AddInventoryItemDialog";
import InventoryItemCombobox from "../inventory/InventoryItemCombobox";
import { catalogItemToOrderMaterial, parseOrderMaterialQuantity } from "../inventory/orderMaterialLine";
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
  errors?: { root?: { message?: string }; [index: number]: { quantity?: { message?: string } } | undefined };
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

  function adjustQuantity(index: number, delta: number) {
    const current = parseOrderMaterialQuantity(getValues(`materials.${index}.quantity`)) ?? 0;
    const next = current + delta;
    if (next < 1) return;
    setValue(`materials.${index}.quantity`, next, { shouldDirty: true, shouldValidate: true });
  }

  function handleSelect(item: InventoryItem) {
    const existingIndex = fields.findIndex((field) => field.inventoryItemId === item.id);
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

  return (
    <div className="space-y-1.5">
      <Label htmlFor="order-material">{t("orders.form.materialsSection")}</Label>
      <InventoryItemCombobox
        items={inventoryItems}
        onSelect={handleSelect}
        onCreateRequest={disabled ? undefined : handleCreateRequest}
        errors={!!errors?.root}
      />
      <p className="text-xs text-muted-foreground">{t("orders.form.materialsRequestHint")}</p>
      <AddInventoryItemDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialName={createInitialName}
        onCreated={handleSelect}
      />
      {errors?.root?.message && <p className="text-xs text-destructive">{errors.root.message}</p>}

      {fields.length > 0 && (
        <div className="space-y-2">
          {fields.map((field, index) => {
            const line = watched?.[index];
            const unitPrice = line?.price ?? field.price ?? 0;
            const parsedQty = parseOrderMaterialQuantity(line?.quantity ?? field.quantity);
            const stock = inventoryItems.find((item) => item.id === field.inventoryItemId)?.quantity;
            const quantityError = errors?.[index]?.quantity;
            const quantityInputId = `order-material-qty-${field.id}`;

            return (
              <div key={field.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium [overflow-wrap:anywhere]">{field.itemName}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {t("orders.detail.price")}: <span className="tabular-nums">{formatMoney(unitPrice)}</span>
                    </p>
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
                    aria-label={t("orders.form.removeMaterial", { name: field.itemName })}
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
                      aria-label={t("orders.form.decreaseQuantity", { name: field.itemName })}
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
                          aria-label={t("orders.form.quantityForMaterial", { name: field.itemName })}
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
                      aria-label={t("orders.form.increaseQuantity", { name: field.itemName })}
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
