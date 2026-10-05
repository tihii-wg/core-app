import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Textarea } from "../../ui/Textarea";
import { Spinner } from "../../ui/Spinner";

import type { EditServiceFormData, Service } from "../../lib/types";
import useUpdateService from "./useUpdateService";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";

type EditServiceFormProps = {
  service: Service;
  setEditModalOpen: (open: boolean) => void;
};

export default function UpdateServiceForm({ service, setEditModalOpen }: EditServiceFormProps) {
  const { t } = useTranslation();
  const { mutateAsync: updateService } = useUpdateService();
  const { currency } = useWorkspaceMoney();

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
      price: service.service_price,
      description: service.description ?? "",
    },
  });

  useEffect(() => {
    reset({
      serviceName: service.service_name,
      status: service.status,
      price: service.service_price,
      description: service.description ?? "",
    });
  }, [service, reset]);

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
        {/* Service name */}
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

        {/* Status + Price */}
        <div className="grid grid-cols-2 gap-4">
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
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label htmlFor="description">{t("services.form.descriptionLabel")}</Label>

          <Textarea id="description" {...register("description")} rows={3} />
        </div>

        {/* Buttons */}
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
