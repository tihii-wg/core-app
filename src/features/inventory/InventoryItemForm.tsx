import { Controller, useForm } from "react-hook-form";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Switch } from "../../ui/Switch";
import { Textarea } from "../../ui/Textarea";
import { Spinner } from "../../ui/Spinner";
import type { InventoryItemFormData } from "../../lib/types";

type InventoryItemFormProps = {
  defaultValues: InventoryItemFormData;
  submitLabel: string;
  isSubmitting: boolean;
  onSubmit: (data: InventoryItemFormData) => void;
  onCancel: () => void;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-[#f41f20]">{message}</p>;
}

export default function InventoryItemForm({ defaultValues, submitLabel, isSubmitting, onSubmit, onCancel }: InventoryItemFormProps) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<InventoryItemFormData>({ defaultValues });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
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
            className={errors.name ? "border-[#f41f20]" : ""}
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
              className={errors.quantity ? "border-[#f41f20]" : ""}
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
              className={errors.minQuantity ? "border-[#f41f20]" : ""}
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
            className={errors.unit ? "border-[#f41f20]" : ""}
          />
          <FieldError message={errors.unit?.message} />
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
                  onChange={(event) => field.onChange(event.target.value === "" ? null : Number(event.target.value))}
                  placeholder="Optional"
                  className={errors.purchasePrice ? "border-[#f41f20]" : ""}
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
                  className={errors.sellingPrice ? "border-[#f41f20]" : ""}
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
          <Button type="submit" disabled={isSubmitting} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
            {isSubmitting ? <Spinner className="h-4 w-4" /> : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
