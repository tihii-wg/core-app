import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import { Textarea } from "../../ui/Textarea";
import type { EditOrderFormData, Order } from "../../lib/types";
import ServiceCombobox from "../services/ServiceCombobox";
import useGetServices from "../services/useGetServices";
import useGetEmployees from "../employees/useGetEmployees";
import { useUpdateOrder } from "./useUpdateOrder";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { canManageServices } from "../workspaces/workspaceRoles";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { assignableTechnicians } from "./assignableTechnicians";
import OrderAssetFields from "./OrderAssetFields";

type EditOrderFormProps = {
  order: Order;
  onCancel: () => void;
  onUpdated: (order: Order) => void;
};

export default function EditOrderForm({ order, onCancel, onUpdated }: EditOrderFormProps) {
  const { t } = useTranslation();
  const { mutateAsync: updateOrder } = useUpdateOrder();
  const { services } = useGetServices();
  const { employees, error: employeesError, isLoading: employeesLoading } = useGetEmployees();
  const { formatMoney } = useWorkspaceMoney();
  const { workflow, copy } = useIndustryWorkflow();
  const canCreateServices = canManageServices(useActiveWorkspaceRole());
  const activeServices = services?.filter((service) => service.status === "active");
  const techniciansError = employeesError;
  const technicianOptions = assignableTechnicians(employees, order.assignedEmployeeId);

  const {
    control,
    register,
    handleSubmit,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<EditOrderFormData>({
    defaultValues: {
      device: order.device,
      carNumber: order.carNumber,
      vin: order.vin,
      description: order.description,
      assignedEmployeeId: order.assignedEmployeeId,
      deadline: order.deadline,
      services: order.services,
    },
  });

  const {
    fields: serviceFields,
    append: serviceAppend,
    remove: serviceRemove,
  } = useFieldArray({
    control,
    name: "services",
    keyName: "fieldKey",
    rules: {
      required: t("orders.validation.serviceRequired"),
      minLength: {
        value: 1,
        message: t("orders.validation.serviceRequired"),
      },
    },
  });

  const watchedServices = useWatch({ control, name: "services" });
  const totalPrice = (watchedServices ?? []).reduce((total, service) => total + (service.price ?? 0) * service.quantity, 0);

  function hasService(serviceId: string | null, serviceName: string) {
    return serviceFields.some((field) => (serviceId !== null && field.serviceId === serviceId) || field.serviceName.toLowerCase() === serviceName.toLowerCase());
  }

  const onSubmit = async (data: EditOrderFormData) => {
    try {
      // Preserve vehicle fields that are hidden for this industry so historical values are not wiped.
      const updatedOrder = await updateOrder({
        orderId: order.id,
        ...data,
        carNumber: workflow.orderFields.carNumber.visible ? data.carNumber : order.carNumber,
        vin: workflow.orderFields.vin.visible ? data.vin : order.vin,
        device: workflow.orderFields.device.visible ? data.device : order.device || data.device,
      });
      onUpdated(updatedOrder);
    } catch {
      return;
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <OrderAssetFields register={register} errors={errors} workflow={workflow} copy={copy} idPrefix="edit-order-" disabled={isSubmitting} preserveHiddenValues />

      <div className="space-y-1.5">
        <Label htmlFor="service">{t("orders.form.addServiceLabel")}</Label>
        <ServiceCombobox
          services={activeServices}
          allowCreate={canCreateServices}
          errors={!!errors.services?.root}
          onSelect={(service) => {
            if (hasService(service.id, service.service_name)) return;

            serviceAppend({
              serviceId: service.id,
              serviceName: service.service_name,
              price: service.service_price ?? 0,
              quantity: 1,
            });
            clearErrors("services");
          }}
          onCreate={(serviceName, price) => {
            if (hasService(null, serviceName)) return;

            serviceAppend({
              serviceId: crypto.randomUUID(),
              serviceName,
              price,
              quantity: 1,
            });
            clearErrors("services");
          }}
        />
        {errors.services?.root?.message && <p className="text-xs text-destructive">{errors.services.root.message}</p>}
        {serviceFields.length > 0 && (
          <div className="space-y-2">
            {serviceFields.map((field, index) => (
              <div key={field.fieldKey} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="font-medium">{field.serviceName}</p>
                  <p className="text-[13px] text-muted-foreground tabular-nums">{formatMoney(field.price)}</p>
                </div>
                <Button type="button" variant="outline" onClick={() => serviceRemove(index)} disabled={isSubmitting} aria-label={t("orders.form.removeService", { name: field.serviceName })}>
                  {t("orders.form.remove")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-order-description">{t("orders.form.descriptionLabel")}</Label>
        <Textarea id="edit-order-description" {...register("description")} placeholder={copy.descriptionPlaceholder} rows={3} disabled={isSubmitting} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="edit-order-employee">{copy.assignedEmployeeLabel}</Label>
          <Controller
            name="assignedEmployeeId"
            control={control}
            render={({ field }) => (
              <Select value={field.value ?? ""} onValueChange={field.onChange}>
                <SelectTrigger id="edit-order-employee">
                  <SelectValue placeholder={t("orders.form.selectPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {technicianOptions.map((technician) => (
                    <SelectItem key={technician.id} value={technician.id}>
                      {technician.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {techniciansError && (
            <p className="text-xs text-destructive">{techniciansError instanceof Error ? techniciansError.message : t("orders.form.techniciansLoadFailed")}</p>
          )}
          {!techniciansError && !employeesLoading && employees && technicianOptions.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("orders.form.noLinkedTechnicians")}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-order-deadline">{copy.deadlineLabel}</Label>
          <Input id="edit-order-deadline" type="date" {...register("deadline")} disabled={isSubmitting} />
        </div>
      </div>

      <div className="flex justify-between border-t pt-3">
        <span className="text-lg font-semibold">{t("orders.form.totalPrice")}</span>
        <span className="tabular-nums">{formatMoney(totalPrice)}</span>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner className="h-4 w-4" /> : t("common.saveChanges")}
        </Button>
      </div>
    </form>
  );
}
