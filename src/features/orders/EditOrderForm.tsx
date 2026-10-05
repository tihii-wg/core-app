import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import { Textarea } from "../../ui/Textarea";
import type { EditOrderFormData, Employee, Order } from "../../lib/types";
import ServiceCombobox from "../services/ServiceCombobox";
import useGetServices from "../services/useGetServices";
import { useUpdateOrder } from "./useUpdateOrder";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { canManageServices } from "../workspaces/workspaceRoles";

type EditOrderFormProps = {
  order: Order;
  employees: Employee[];
  onCancel: () => void;
  onUpdated: (order: Order) => void;
};

export default function EditOrderForm({ order, employees, onCancel, onUpdated }: EditOrderFormProps) {
  const { t } = useTranslation();
  const { mutateAsync: updateOrder } = useUpdateOrder();
  const { services } = useGetServices();
  const { formatMoney } = useWorkspaceMoney();
  const canCreateServices = canManageServices(useActiveWorkspaceRole());
  const activeServices = services?.filter((service) => service.status === "active");

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

  const technicianOptions = employees.filter(
    (employee) => employee.id && (employee.id === order.assignedEmployeeId || (employee.profile_id && employee.status === "active" && employee.role === "technician")),
  );

  const onSubmit = async (data: EditOrderFormData) => {
    try {
      const updatedOrder = await updateOrder({
        orderId: order.id,
        ...data,
      });
      onUpdated(updatedOrder);
    } catch {
      return;
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="edit-order-device">{t("orders.form.deviceLabel")}</Label>
        <Input
          id="edit-order-device"
          {...register("device", { required: t("orders.validation.deviceRequired") })}
          className={errors.device ? "border-destructive" : ""}
          disabled={isSubmitting}
        />
        {errors.device && <p className="text-xs text-destructive">{errors.device.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-order-car-number">{t("orders.form.carNumberLabel")}</Label>
        <Input
          id="edit-order-car-number"
          {...register("carNumber", {
            required: t("orders.validation.carNumberRequired"),
            setValueAs: (value: string) => value.trim().toUpperCase(),
          })}
          className={errors.carNumber ? "border-destructive" : ""}
          disabled={isSubmitting}
        />
        {errors.carNumber && <p className="text-xs text-destructive">{errors.carNumber.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-order-vin">{t("orders.form.vinLabel")}</Label>
        <Input
          id="edit-order-vin"
          {...register("vin", {
            required: t("orders.validation.vinRequired"),
            setValueAs: (value: string) => value.trim().toUpperCase(),
            validate: (value) => value.length === 17 || t("orders.validation.vinLength"),
          })}
          placeholder={t("orders.form.vinPlaceholder")}
          maxLength={17}
          autoCapitalize="characters"
          spellCheck={false}
          className={errors.vin ? "border-destructive" : ""}
          disabled={isSubmitting}
        />
        {errors.vin && <p className="text-xs text-destructive">{errors.vin.message}</p>}
      </div>

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
        <Textarea id="edit-order-description" {...register("description")} rows={3} disabled={isSubmitting} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="edit-order-employee">{t("orders.form.assignedEmployeeLabel")}</Label>
          <Controller
            name="assignedEmployeeId"
            control={control}
            render={({ field }) => (
              <Select value={field.value ?? ""} onValueChange={field.onChange}>
                <SelectTrigger id="edit-order-employee">
                  <SelectValue placeholder={t("orders.form.selectPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {technicianOptions.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {technicianOptions.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("orders.form.noLinkedTechnicians")}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-order-deadline">{t("orders.form.deadlineLabel")}</Label>
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
