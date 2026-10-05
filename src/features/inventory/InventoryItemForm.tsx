import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
          <Label htmlFor="inventory-name">{t("inventory.form.nameLabel")}</Label>
          <Input
            id="inventory-name"
            {...register("name", {
              required: t("inventory.form.nameRequired"),
              validate: (value) => value.trim().length > 0 || t("inventory.form.nameRequired"),
            })}
            placeholder={t("inventory.form.namePlaceholder")}
            className={errors.name ? "border-destructive" : ""}
          />
          <FieldError message={errors.name?.message} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="inventory-sku">{t("inventory.fields.sku")}</Label>
            <Input id="inventory-sku" {...register("sku")} placeholder={t("common.optional")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inventory-category">{t("inventory.fields.category")}</Label>
            <Input id="inventory-category" {...register("category")} placeholder={t("common.optional")} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inventory-description">{t("inventory.fields.description")}</Label>
          <Textarea id="inventory-description" {...register("description")} rows={3} placeholder={t("common.optional")} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="inventory-quantity">{t("inventory.form.quantityLabel")}</Label>
            <Input
              id="inventory-quantity"
              type="number"
              min={0}
              step="any"
              {...register("quantity", {
                valueAsNumber: true,
                required: t("inventory.form.quantityRequired"),
                min: { value: 0, message: t("inventory.form.quantityNegative") },
                validate: (value) => Number.isFinite(value) || t("inventory.form.quantityRequired"),
              })}
              className={errors.quantity ? "border-destructive" : ""}
            />
            <FieldError message={errors.quantity?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inventory-min-quantity">{t("inventory.form.minQuantityLabel")}</Label>
            <Input
              id="inventory-min-quantity"
              type="number"
              min={0}
              step="any"
              {...register("minQuantity", {
                valueAsNumber: true,
                required: t("inventory.form.minQuantityRequired"),
                min: { value: 0, message: t("inventory.form.minQuantityNegative") },
                validate: (value) => Number.isFinite(value) || t("inventory.form.minQuantityRequired"),
              })}
              className={errors.minQuantity ? "border-destructive" : ""}
            />
            <FieldError message={errors.minQuantity?.message} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inventory-unit">{t("inventory.form.unitLabel")}</Label>
          <Input
            id="inventory-unit"
            {...register("unit", {
              required: t("inventory.form.unitRequired"),
              validate: (value) => value.trim().length > 0 || t("inventory.form.unitRequired"),
            })}
            placeholder={t("inventory.form.defaultUnit")}
            className={errors.unit ? "border-destructive" : ""}
          />
          <FieldError message={errors.unit?.message} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inventory-markup">{t("inventory.form.markupLabel")}</Label>
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
          <p className="text-xs text-muted-foreground">{t("inventory.form.markupHint")}</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="inventory-purchase-price">{t("inventory.fields.purchasePrice")}</Label>
            <Controller
              name="purchasePrice"
              control={control}
              rules={{
                validate: (value) => value == null || value >= 0 || t("inventory.form.purchasePriceNegative"),
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
                  placeholder={t("common.optional")}
                  className={errors.purchasePrice ? "border-destructive" : ""}
                />
              )}
            />
            <FieldError message={errors.purchasePrice?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inventory-selling-price">{t("inventory.fields.sellingPrice")}</Label>
            <Controller
              name="sellingPrice"
              control={control}
              rules={{
                validate: (value) => value == null || value >= 0 || t("inventory.form.sellingPriceNegative"),
              }}
              render={({ field }) => (
                <Input
                  id="inventory-selling-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={field.value ?? ""}
                  onChange={(event) => field.onChange(event.target.value === "" ? null : Number(event.target.value))}
                  placeholder={t("common.optional")}
                  className={errors.sellingPrice ? "border-destructive" : ""}
                />
              )}
            />
            <FieldError message={errors.sellingPrice?.message} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="inventory-supplier">{t("inventory.fields.supplier")}</Label>
            <Input id="inventory-supplier" {...register("supplier")} placeholder={t("common.optional")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inventory-location">{t("inventory.fields.location")}</Label>
            <Input id="inventory-location" {...register("location")} placeholder={t("common.optional")} />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="inventory-active">{t("inventory.active")}</Label>
          <Controller name="isActive" control={control} render={({ field }) => <Switch id="inventory-active" checked={field.value} onCheckedChange={field.onChange} />} />
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner className="h-4 w-4" /> : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
