import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Textarea } from "../../ui/Textarea";
import { Spinner } from "../../ui/Spinner";

import type { EditServiceFormData, Service, serviceCategory } from "../../lib/types";
import { defaultServiceCategory, industryServiceCategoryOptions, industryServiceCopy, serviceCategoryLabel } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import useUpdateService from "./useUpdateService";

type EditServiceFormProps = {
  service: Service;
  setEditModalOpen: (open: boolean) => void;
};

function asCategory(value: string | null | undefined): serviceCategory | "" {
  if (!value?.trim()) return "";
  return value as serviceCategory;
}

export default function UpdateServiceForm({ service, setEditModalOpen }: EditServiceFormProps) {
  const { t } = useTranslation();
  const { mutateAsync: updateService } = useUpdateService();
  const { currency } = useWorkspaceMoney();
  const { workflow } = useIndustryWorkflow();
  const copy = industryServiceCopy(workflow);
  const categoryOptions = industryServiceCategoryOptions(workflow, service.category);

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
    });
  }, [
    service.id,
    service.service_name,
    service.status,
    service.category,
    service.service_price,
    service.description,
    reset,
    workflow.slug,
  ]);

  const onSubmit = async (data: EditServiceFormData) => {
    try {
      await updateService({ serviceId: service.id, ...data });
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
                        {serviceCategoryLabel(category)}
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
