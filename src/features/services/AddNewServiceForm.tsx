import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import { Textarea } from "../../ui/Textarea";
import type { CreateMadalProps, addNewServiceFormData } from "../../lib/types";
import { defaultServiceCategory, industryServiceCategoryOptions, industryServiceCopy, serviceCategoryLabel } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import ServiceCombobox from "./ServiceCombobox";
import useCreateNewService from "./useCreateNewService";
import useGetServices from "./useGetServices";

export default function AddNewServiceForm({ setCreateModalOpen }: CreateMadalProps) {
  const { t } = useTranslation();
  const { mutate } = useCreateNewService();
  const { services } = useGetServices();
  const { currency } = useWorkspaceMoney();
  const { workflow } = useIndustryWorkflow();
  const copy = industryServiceCopy(workflow);
  const categoryOptions = industryServiceCategoryOptions(workflow);

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
      category: defaultServiceCategory(workflow),
      price: undefined,
      description: "",
    },
  });

  const onSubmit = (data: addNewServiceFormData) => {
    mutate(data, {
      onSuccess: () => {
        reset({
          serviceName: "",
          status: "active",
          category: defaultServiceCategory(workflow),
          price: undefined,
          description: "",
        });
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
            render={({ field }) => <ServiceCombobox services={services} value={field.value} onChange={field.onChange} errors={Boolean(errors.serviceName)} />}
          />
          {errors.serviceName && <p className="text-xs text-destructive">{t("services.form.serviceNameRequired")}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="category">{t("services.form.categoryLabel")}</Label>
            <Controller
              name="category"
              control={control}
              rules={{ required: t("services.form.categoryRequired") }}
              render={({ field }) => (
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <SelectTrigger id="category" className={errors.category ? "border-destructive" : ""}>
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
            <Label htmlFor="status">{t("common.status")}</Label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="status">
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
            placeholder="0.00"
            className={errors.price ? "border-destructive" : ""}
          />
          {errors.price && <p className="text-xs text-destructive">{errors.price.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">{t("services.form.descriptionLabel")}</Label>
          <Textarea id="description" {...register("description")} placeholder={copy.descriptionPlaceholder} rows={3} />
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
