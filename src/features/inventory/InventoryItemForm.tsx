import { useFormFieldLayout } from "../formFields/useFormFields";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Switch } from "../../ui/Switch";
import { Textarea } from "../../ui/Textarea";
import { Spinner } from "../../ui/Spinner";
import type { InventoryItemFormData } from "../../lib/types";
import { industryUsesMileageWarranty } from "../industries/industryCapabilities";
import { industryInventoryCopy } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import CatalogWarrantyFields from "../orders/CatalogWarrantyFields";
import { emptyCatalogWarrantyFormValues, normalizeCatalogWarrantyDefaults, type CatalogWarrantyDefaults } from "../orders/catalogWarranty";
import { parseMarkupPercent, markupFieldError, sellingPriceFromMarkup } from "./markup";

function warrantyFromFormDefaults(defaults: InventoryItemFormData): CatalogWarrantyDefaults {
  if (defaults.warrantyType == null && defaults.warrantyMonths == null && defaults.warrantyKm == null) {
    return emptyCatalogWarrantyFormValues();
  }
  try {
    return normalizeCatalogWarrantyDefaults({
      warrantyType: defaults.warrantyType ?? "none",
      warrantyMonths: defaults.warrantyMonths,
      warrantyKm: defaults.warrantyKm,
    });
  } catch {
    return emptyCatalogWarrantyFormValues();
  }
}

type InventoryItemFormProps = {
  defaultValues: InventoryItemFormData;
  markupPercent: number;
  submitLabel: string;
  isSubmitting: boolean;
  onSubmit: (data: InventoryItemFormData) => void;
  onCancel: () => void;
  onMarkupCommit: (markupPercent: number) => void;
  /** When warehouses are enabled, quantity is read-only / forced to create-at-zero. */
  lockQuantity?: boolean;
  /** True when creating a new catalog item (shows create-at-zero hint). */
  isCreate?: boolean;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

export default function InventoryItemForm({
  defaultValues,
  markupPercent,
  submitLabel,
  isSubmitting,
  onSubmit,
  onCancel,
  onMarkupCommit,
  lockQuantity = false,
  isCreate = false,
}: InventoryItemFormProps) {
  const { t } = useTranslation();
  const { workflow } = useIndustryWorkflow();
  const showWarrantyKm = industryUsesMileageWarranty(workflow);
  const inventoryCopy = industryInventoryCopy(workflow);
  const [markupText, setMarkupText] = useState(String(markupPercent));
  const [markupError, setMarkupError] = useState("");
  const [warranty, setWarranty] = useState<CatalogWarrantyDefaults>(() => warrantyFromFormDefaults(defaultValues));
  const [warrantyError, setWarrantyError] = useState<string | null>(null);
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
    setWarranty(warrantyFromFormDefaults(defaultValues));
    setWarrantyError(null);
  }, [
    defaultValues.warrantyType,
    defaultValues.warrantyMonths,
    defaultValues.warrantyKm,
    defaultValues.name,
    defaultValues.sku,
  ]);

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

  const layout = useFormFieldLayout("product");

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

        let normalized;
        try {
          normalized = normalizeCatalogWarrantyDefaults(warranty);
          setWarrantyError(null);
        } catch {
          setWarrantyError(
            warranty.warrantyType === "both"
              ? t("catalogWarranty.errors.bothRequired")
              : warranty.warrantyType === "mileage"
                ? t("catalogWarranty.errors.mileageRequired")
                : t("catalogWarranty.errors.durationRequired"),
          );
          return;
        }

        onMarkupCommit(parsed);
        const withWarranty = {
          ...data,
          warrantyType: normalized.warrantyType,
          warrantyMonths: normalized.warrantyMonths,
          warrantyKm: normalized.warrantyKm,
        };
        onSubmit(lockQuantity ? { ...withWarranty, quantity: isCreate ? 0 : defaultValues.quantity } : withWarranty);
      })}
    >
      <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
        {layout.arrange<{ key: string; node: ReactNode }>([
        { key: "name", node: (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="inventory-name">{layout.label("name", t("inventory.form.nameLabel"))}</Label>
          <Input
            id="inventory-name"
            {...register("name", {
              required: t("inventory.form.nameRequired"),
              validate: (value) => value.trim().length > 0 || t("inventory.form.nameRequired"),
            })}
            placeholder={inventoryCopy.namePlaceholder}
            className={errors.name ? "border-destructive" : ""}
          />
          <FieldError message={errors.name?.message} />
        </div>
        ) },
        { key: "sku", node: (
          <div className="space-y-1.5">
            <Label htmlFor="inventory-sku">{layout.label("sku", t("inventory.fields.sku"))}</Label>
            <Input id="inventory-sku" {...register("sku")} placeholder={t("inventory.form.skuPlaceholder")} />
          </div>
        ) },
        { key: "category", node: (
          <div className="space-y-1.5">
            <Label htmlFor="inventory-category">{layout.label("category", t("inventory.fields.category"))}</Label>
            <Input id="inventory-category" {...register("category")} placeholder={inventoryCopy.categoryPlaceholder} />
          </div>
        ) },
        { key: "description", node: (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="inventory-description">{layout.label("description", t("inventory.fields.description"))}</Label>
          <Textarea id="inventory-description" {...register("description")} rows={3} placeholder={t("inventory.form.descriptionPlaceholder")} />
        </div>
        ) },
        { key: "quantity", node: (
          <div className="space-y-1.5">
            <Label htmlFor="inventory-quantity">{layout.label("quantity", t("inventory.form.quantityLabel"))}</Label>
            <Input
              id="inventory-quantity"
              type="number"
              min={0}
              step="any"
              readOnly={lockQuantity}
              disabled={lockQuantity}
              {...register("quantity", {
                valueAsNumber: true,
                required: t("inventory.form.quantityRequired"),
                min: { value: 0, message: t("inventory.form.quantityNegative") },
                validate: (value) => Number.isFinite(value) || t("inventory.form.quantityRequired"),
              })}
              className={errors.quantity ? "border-destructive" : ""}
            />
            {lockQuantity ? (
              <p className="text-xs text-muted-foreground">
                {isCreate ? t("inventory.form.quantityCreateZeroHint") : t("inventory.form.quantityLockedHint")}
              </p>
            ) : null}
            <FieldError message={errors.quantity?.message} />
          </div>
        ) },
        { key: "minQuantity", node: (
          <div className="space-y-1.5">
            <Label htmlFor="inventory-min-quantity">{layout.label("minQuantity", t("inventory.form.minQuantityLabel"))}</Label>
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
            <p className="text-xs text-muted-foreground">{t("inventory.form.minQuantityHint")}</p>
          </div>
        ) },
        { key: "unit", node: (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="inventory-unit">{layout.label("unit", t("inventory.form.unitLabel"))}</Label>
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
        ) },
        { key: "markup", node: (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="inventory-markup">{layout.label("markup", t("inventory.form.markupLabel"))}</Label>
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
        ) },
        { key: "purchasePrice", node: (
          <div className="space-y-1.5">
            <Label htmlFor="inventory-purchase-price">{layout.label("purchasePrice", t("inventory.fields.purchasePrice"))}</Label>
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
                  placeholder={t("inventory.form.purchasePricePlaceholder")}
                  className={errors.purchasePrice ? "border-destructive" : ""}
                />
              )}
            />
            <FieldError message={errors.purchasePrice?.message} />
          </div>
        ) },
        { key: "sellingPrice", node: (
          <div className="space-y-1.5">
            <Label htmlFor="inventory-selling-price">{layout.label("sellingPrice", t("inventory.fields.sellingPrice"))}</Label>
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
                  placeholder={t("inventory.form.sellingPricePlaceholder")}
                  className={errors.sellingPrice ? "border-destructive" : ""}
                />
              )}
            />
            <FieldError message={errors.sellingPrice?.message} />
          </div>
        ) },
        { key: "supplier", node: (
          <div className="space-y-1.5">
            <Label htmlFor="inventory-supplier">{layout.label("supplier", t("inventory.fields.supplier"))}</Label>
            <Input id="inventory-supplier" {...register("supplier")} placeholder={t("inventory.form.supplierPlaceholder")} />
          </div>
        ) },
        { key: "location", node: (
          <div className="space-y-1.5">
            <Label htmlFor="inventory-location">{layout.label("location", t("inventory.fields.location"))}</Label>
            <Input id="inventory-location" {...register("location")} placeholder={inventoryCopy.locationPlaceholder} />
          </div>
        ) },
        { key: "isActive", node: (
        <div className="flex items-center justify-between sm:col-span-2">
          <Label htmlFor="inventory-active">{layout.label("isActive", t("inventory.active"))}</Label>
          <Controller name="isActive" control={control} render={({ field }) => <Switch id="inventory-active" checked={field.value} onCheckedChange={field.onChange} />} />
        </div>
        ) },
        { key: "warranty", node: (
        <div className="sm:col-span-2">
        <CatalogWarrantyFields
          idPrefix="inventory-item"
          value={warranty}
          showWarrantyKm={showWarrantyKm}
          onChange={(next) => {
            setWarranty(next);
            setWarrantyError(null);
          }}
          error={warrantyError}
        />
        </div>
        ) },
        ]).map((block) => (
          <Fragment key={block.key}>{block.node}</Fragment>
        ))}

        <div className="flex justify-end gap-2 sm:col-span-2">
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
