import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Textarea } from "../../ui/Textarea";
import { Spinner } from "../../ui/Spinner";

import type { EditServiceFormData, Service, serviceCategory } from "../../lib/types";
import {
  defaultServiceCategory,
  industryServiceCategoryOptions,
  industryServiceCopy,
  normalizeServiceCategory,
  serviceCategoryLabel,
} from "../industries/industryWorkflow";
import { industryUsesMileageWarranty } from "../industries/industryCapabilities";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import CatalogWarrantyFields from "../orders/CatalogWarrantyFields";
import { emptyCatalogWarrantyFormValues, normalizeCatalogWarrantyDefaults, type CatalogWarrantyDefaults } from "../orders/catalogWarranty";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import useUpdateService from "./useUpdateService";
import useGetEmployees from "../employees/useGetEmployees";
import { assignableTechnicians } from "../orders/assignableTechnicians";

const NO_DEFAULT_PERFORMER = "__none__";

function warrantyFromService(service: Service): CatalogWarrantyDefaults {
  if (service.warrantyType == null && service.warrantyMonths == null && service.warrantyKm == null) {
    return emptyCatalogWarrantyFormValues();
  }
  try {
    return normalizeCatalogWarrantyDefaults({
      warrantyType: service.warrantyType ?? "none",
      warrantyMonths: service.warrantyMonths,
      warrantyKm: service.warrantyKm,
    });
  } catch {
    return emptyCatalogWarrantyFormValues();
  }
}

type EditServiceFormProps = {
  service: Service;
  setEditModalOpen: (open: boolean) => void;
};

function asCategory(value: string | null | undefined): serviceCategory | "" {
  return normalizeServiceCategory(value);
}

export default function UpdateServiceForm({ service, setEditModalOpen }: EditServiceFormProps) {
  const { t } = useTranslation();
  const { mutateAsync: updateService } = useUpdateService();
  const { employees } = useGetEmployees();
  const technicianOptions = assignableTechnicians(employees, service.defaultTechnicianId);
  const { currency } = useWorkspaceMoney();
  const { workflow } = useIndustryWorkflow();
  const showWarrantyKm = industryUsesMileageWarranty(workflow);
  const copy = industryServiceCopy(workflow);
  const categoryOptions = industryServiceCategoryOptions(workflow, service.category);

  const [warranty, setWarranty] = useState<CatalogWarrantyDefaults>(() => warrantyFromService(service));
  const [warrantyError, setWarrantyError] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EditServiceFormData>({
    defaultValues: {
      serviceName: service.service_name,
      status: service.status,
      category: asCategory(service.category) || defaultServiceCategory(workflow),
      price: service.service_price,
      description: service.description ?? "",
      defaultTechnicianId: service.defaultTechnicianId ?? "",
    },
  });

  // Depend on stable service fields and workflow.slug — industryWorkflow() returns a new
  // object each render, so using `workflow` here caused Maximum update depth exceeded.
  useEffect(() => {
    reset({
      serviceName: service.service_name,
      status: service.status,
      category: asCategory(service.category) || defaultServiceCategory(workflow),
      price: service.service_price,
      description: service.description ?? "",
      defaultTechnicianId: service.defaultTechnicianId ?? "",
    });
    setWarranty(warrantyFromService(service));
    setWarrantyError(null);
  }, [
    service.id,
    service.service_name,
    service.status,
    service.category,
    service.service_price,
    service.description,
    service.defaultTechnicianId,
    service.warrantyType,
    service.warrantyMonths,
    service.warrantyKm,
    reset,
    workflow.slug,
  ]);

  const onSubmit = async (data: EditServiceFormData) => {
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

    try {
      await updateService({
        serviceId: service.id,
        ...data,
        warrantyType: normalized.warrantyType,
        warrantyMonths: normalized.warrantyMonths,
        warrantyKm: normalized.warrantyKm,
      });
    } catch {
      return;
    }
    setEditModalOpen(false);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="serviceName">{t("services.form.serviceNameLabel")}</Label>
          <Input
            id="serviceName"
            {...register("serviceName", {
              required: t("services.form.serviceNameRequired"),
            })}
            className={errors.serviceName ? "border-destructive" : ""}
          />
          {errors.serviceName && <p className="text-xs text-destructive">{errors.serviceName.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-service-category">{t("services.form.categoryLabel")}</Label>
            <Controller
              name="category"
              control={control}
              rules={{ required: t("services.form.categoryRequired") }}
              render={({ field }) => (
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <SelectTrigger id="edit-service-category" className={errors.category ? "border-destructive" : ""}>
                    <SelectValue placeholder={t("services.form.categoryLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((category) => (
                      <SelectItem key={category} value={category}>
                        {serviceCategoryLabel(category, workflow.slug)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.category && <p className="text-xs text-destructive">{errors.category.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>{t("common.status")}</Label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t("services.statuses.active")}</SelectItem>
                    <SelectItem value="inactive">{t("services.statuses.inactive")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="price">{t("services.form.priceLabel", { currency })}</Label>
          <Input
            id="price"
            type="number"
            step="0.01"
            {...register("price", {
              valueAsNumber: true,
              required: t("services.form.priceRequired"),
              min: {
                value: 0,
                message: t("services.form.priceNegative"),
              },
            })}
            className={errors.price ? "border-destructive" : ""}
          />
          {errors.price && <p className="text-xs text-destructive">{errors.price.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">{t("services.form.descriptionLabel")}</Label>
          <Textarea id="description" {...register("description")} placeholder={copy.descriptionPlaceholder} rows={3} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-service-default-technician">{t("orders.team.defaultPerformer")}</Label>
          <Controller
            name="defaultTechnicianId"
            control={control}
            render={({ field }) => (
              <Select
                value={field.value || NO_DEFAULT_PERFORMER}
                onValueChange={(next) => field.onChange(next === NO_DEFAULT_PERFORMER ? "" : next)}
                disabled={isSubmitting}
              >
                <SelectTrigger id="edit-service-default-technician" className="w-full">
                  <SelectValue placeholder={t("orders.team.notAssigned")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEFAULT_PERFORMER}>{t("orders.team.notAssigned")}</SelectItem>
                  {technicianOptions.map((technician) => (
                    <SelectItem key={technician.id} value={technician.id}>
                      {technician.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <CatalogWarrantyFields
          idPrefix="edit-service"
          value={warranty}
          showWarrantyKm={showWarrantyKm}
          onChange={(next) => {
            setWarranty(next);
            setWarrantyError(null);
          }}
          error={warrantyError}
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => setEditModalOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner className="h-4 w-4" /> : t("common.saveChanges")}
          </Button>
        </div>
      </div>
    </form>
  );
}
