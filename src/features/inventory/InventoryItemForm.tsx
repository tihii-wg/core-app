import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Switch } from "../../ui/Switch";
import { Textarea } from "../../ui/Textarea";
import { Spinner } from "../../ui/Spinner";
import type { InventoryItemFormData } from "../../lib/types";
import { parseMarkupPercent, markupFieldError, sellingPriceFromMarkup } from "./markup";

type InventoryItemFormProps = {
  defaultValues: InventoryItemFormData;
  markupPercent: number;
  submitLabel: string;
  isSubmitting: boolean;
  onSubmit: (data: InventoryItemFormData) => void;
  onCancel: () => void;
  onMarkupCommit: (markupPercent: number) => void;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

export default function InventoryItemForm({ defaultValues, markupPercent, submitLabel, isSubmitting, onSubmit, onCancel, onMarkupCommit }: InventoryItemFormProps) {
  const [markupText, setMarkupText] = useState(String(markupPercent));
  const [markupError, setMarkupError] = useState("");
  const skipMarkupUpdate = useRef(true);
  const {
    control,
    register,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<InventoryItemFormData>({ defaultValues });

  useEffect(() => {
    if (skipMarkupUpdate.current) {
      skipMarkupUpdate.current = false;
      return;
    }

    setMarkupText(String(markupPercent));
    setValue("sellingPrice", sellingPriceFromMarkup(getValues("purchasePrice"), markupPercent), { shouldValidate: true });
  }, [getValues, markupPercent, setValue]);

  function applyMarkup(nextMarkup: string, purchasePrice: number | null) {
    const parsed = parseMarkupPercent(nextMarkup);
    if (parsed == null) return;
    setValue("sellingPrice", sellingPriceFromMarkup(purchasePrice, parsed), { shouldValidate: true });
  }

  return (
    <form
      onSubmit={handleSubmit((data) => {
        const message = markupFieldError(markupText);
        if (message) {
          setMarkupError(message);
          return;
        }
        const parsed = parseMarkupPercent(markupText);
        if (parsed == null) return;
        onMarkupCommit(parsed);
        onSubmit(data);
      })}
    >
      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="inventory-name">Name *</Label>
          <Input
            id="inventory-name"
            {...register("name", {
              required: "Name is required",
              validate: (value) => value.trim().length > 0 || "Name is required",
            })}
            placeholder="e.g., Brake pads"
            className={errors.name ? "border-destructive" : ""}
          />
          <FieldError message={errors.name?.message} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="inventory-sku">SKU</Label>
            <Input id="inventory-sku" {...register("sku")} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inventory-category">Category</Label>
            <Input id="inventory-category" {...register("category")} placeholder="Optional" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inventory-description">Description</Label>
          <Textarea id="inventory-description" {...register("description")} rows={3} placeholder="Optional" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="inventory-quantity">Quantity *</Label>
            <Input
              id="inventory-quantity"
              type="number"
              min={0}
              step="any"
              {...register("quantity", {
                valueAsNumber: true,
                required: "Quantity is required",
                min: { value: 0, message: "Quantity cannot be negative" },
                validate: (value) => Number.isFinite(value) || "Quantity is required",
              })}
              className={errors.quantity ? "border-destructive" : ""}
            />
            <FieldError message={errors.quantity?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inventory-min-quantity">Minimum Quantity *</Label>
            <Input
              id="inventory-min-quantity"
              type="number"
              min={0}
              step="any"
              {...register("minQuantity", {
                valueAsNumber: true,
                required: "Minimum quantity is required",
                min: { value: 0, message: "Minimum quantity cannot be negative" },
                validate: (value) => Number.isFinite(value) || "Minimum quantity is required",
              })}
              className={errors.minQuantity ? "border-destructive" : ""}
            />
            <FieldError message={errors.minQuantity?.message} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inventory-unit">Unit *</Label>
          <Input
            id="inventory-unit"
            {...register("unit", {
              required: "Unit is required",
              validate: (value) => value.trim().length > 0 || "Unit is required",
            })}
            placeholder="pcs"
            className={errors.unit ? "border-destructive" : ""}
          />
          <FieldError message={errors.unit?.message} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inventory-markup">Markup (%)</Label>
          <Input
            id="inventory-markup"
            type="number"
            min={0}
            step="0.01"
            value={markupText}
            onChange={(event) => {
              const nextMarkup = event.target.value;
              setMarkupText(nextMarkup);
              setMarkupError("");
              applyMarkup(nextMarkup, getValues("purchasePrice"));
            }}
            onBlur={() => {
              const message = markupFieldError(markupText);
              if (message) {
                setMarkupError(message);
                return;
              }
              const parsed = parseMarkupPercent(markupText);
              if (parsed == null) return;
              setMarkupError("");
              onMarkupCommit(parsed);
            }}
            className={markupError ? "border-destructive" : ""}
          />
          <FieldError message={markupError} />
          <p className="text-xs text-muted-foreground">Selling price updates from the purchase price and this markup. You can still edit the selling price.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="inventory-purchase-price">Purchase Price</Label>
            <Controller
              name="purchasePrice"
              control={control}
              rules={{
                validate: (value) => value == null || value >= 0 || "Purchase price cannot be negative",
              }}
              render={({ field }) => (
                <Input
                  id="inventory-purchase-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={field.value ?? ""}
                  onChange={(event) => {
                    const purchasePrice = event.target.value === "" ? null : Number(event.target.value);
                    field.onChange(purchasePrice);
                    applyMarkup(markupText, purchasePrice);
                  }}
                  placeholder="Optional"
                  className={errors.purchasePrice ? "border-destructive" : ""}
                />
              )}
            />
            <FieldError message={errors.purchasePrice?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inventory-selling-price">Selling Price</Label>
            <Controller
              name="sellingPrice"
              control={control}
              rules={{
                validate: (value) => value == null || value >= 0 || "Selling price cannot be negative",
              }}
              render={({ field }) => (
                <Input
                  id="inventory-selling-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={field.value ?? ""}
                  onChange={(event) => field.onChange(event.target.value === "" ? null : Number(event.target.value))}
                  placeholder="Optional"
                  className={errors.sellingPrice ? "border-destructive" : ""}
                />
              )}
            />
            <FieldError message={errors.sellingPrice?.message} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="inventory-supplier">Supplier</Label>
            <Input id="inventory-supplier" {...register("supplier")} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inventory-location">Location</Label>
            <Input id="inventory-location" {...register("location")} placeholder="Optional" />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="inventory-active">Active</Label>
          <Controller name="isActive" control={control} render={({ field }) => <Switch id="inventory-active" checked={field.value} onCheckedChange={field.onChange} />} />
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner className="h-4 w-4" /> : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
