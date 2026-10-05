import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import { Textarea } from "../../ui/Textarea";
// import { useMutation } from "@tanstack/react-query";
import useCreateNewService from "./useCreateNewService";
import type { addNewServiceFormData } from "../../lib/types";
import ServiceCombobox from "./ServiceCombobox";
import useGetServices from "./useGetServices";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";

export default function AddNewServiceForm({ setCreateModalOpen }) {
  const { t } = useTranslation();
  const { mutate } = useCreateNewService();
  const { services } = useGetServices();
  const { currency } = useWorkspaceMoney();

  const {
    control,
    handleSubmit,
    register,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<addNewServiceFormData>({
    defaultValues: {
      serviceName: "",
      status: "active",
      // duration: "",
      price: undefined,
      description: "",
    },
  });

  const onSubmit = (data: addNewServiceFormData) => {
    mutate(data, {
      onSuccess: () => {
        reset();
        setCreateModalOpen(false);
      },
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="serviceName">{t("services.form.serviceNameRequiredLabel")}</Label>
          <Controller
            name="serviceName"
            control={control}
            rules={{
              required: t("services.form.serviceRequired"),
            }}
            render={({ field }) => <ServiceCombobox services={services} value={field.value} onChange={field.onChange} errors={errors.serviceName} />}
          />

          {/* <Input
            id="serviceName"
            {...register("serviceName", { required: true })}
            // value={formData.name}
            // onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Screen Replacement"
            className={errors.serviceName ? "border-destructive" : ""}
          /> */}
          {errors.serviceName && <p className="text-xs text-destructive">{t("services.form.serviceNameRequired")}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
              <SelectTrigger className={formErrors.category ? "border-destructive" : ""}>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {categoryOptions.slice(1).map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {formErrors.category && <p className="text-xs text-destructive">{formErrors.category}</p>}
          </div> */}

          <div className="space-y-1.5">
            <Label htmlFor="status">{t("common.status")}</Label>
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
              // value={formData.price}
              // onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              placeholder="0.00"
              className={errors.price ? "border-destructive" : ""}
            />
            {errors.price && <p className="text-xs text-destructive">{errors.price.message}</p>}
          </div>
        </div>

        <div className="grid  gap-4">
          {/* <div className="space-y-1.5"> */}
          {/* <Label htmlFor="daration">Duration (minutes)</Label>
            <Input
              id="duration"
              type="number"
              {...register("duration", { required: true })}
              // value={formData.duration}
              // onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
              placeholder="e.g., 60"
              className={formErrors.duration ? "border-destructive" : ""}
            /> */}
          {/* {errors.duration && <p className="text-xs text-destructive">{formErrors.duration}</p>}
          </div> */}

          {/* </div> */}

          <div className="space-y-1.5">
            <Label htmlFor="description">{t("services.form.descriptionLabel")}</Label>
            <Textarea id="description" {...register("description")} placeholder={t("services.form.descriptionPlaceholder")} rows={3} />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              reset();
              setCreateModalOpen(false);
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner className="h-4 w-4" /> : t("services.addService")}
          </Button>
        </div>
      </div>
    </form>
  );
}
