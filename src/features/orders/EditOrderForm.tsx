import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
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
      required: "Service is required",
      minLength: {
        value: 1,
        message: "Service is required",
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
        <Label htmlFor="edit-order-device">Device *</Label>
        <Input
          id="edit-order-device"
          {...register("device", { required: "Car is required" })}
          className={errors.device ? "border-destructive" : ""}
          disabled={isSubmitting}
        />
        {errors.device && <p className="text-xs text-destructive">{errors.device.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-order-car-number">Car Number *</Label>
        <Input
          id="edit-order-car-number"
          {...register("carNumber", {
            required: "Car number is required",
            setValueAs: (value: string) => value.trim().toUpperCase(),
          })}
          className={errors.carNumber ? "border-destructive" : ""}
          disabled={isSubmitting}
        />
        {errors.carNumber && <p className="text-xs text-destructive">{errors.carNumber.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-order-vin">VIN *</Label>
        <Input
          id="edit-order-vin"
          {...register("vin", {
            required: "VIN is required",
            setValueAs: (value: string) => value.trim().toUpperCase(),
            validate: (value) => value.length === 17 || "VIN must contain exactly 17 characters",
          })}
          placeholder="17-character VIN"
          maxLength={17}
          autoCapitalize="characters"
          spellCheck={false}
          className={errors.vin ? "border-destructive" : ""}
          disabled={isSubmitting}
        />
        {errors.vin && <p className="text-xs text-destructive">{errors.vin.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="service">Add service</Label>
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
                <Button type="button" variant="outline" onClick={() => serviceRemove(index)} disabled={isSubmitting} aria-label={`Remove ${field.serviceName}`}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-order-description">Description</Label>
        <Textarea id="edit-order-description" {...register("description")} rows={3} disabled={isSubmitting} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="edit-order-employee">Assigned Employee</Label>
          <Controller
            name="assignedEmployeeId"
            control={control}
            render={({ field }) => (
              <Select value={field.value ?? ""} onValueChange={field.onChange}>
                <SelectTrigger id="edit-order-employee">
                  <SelectValue placeholder="Select" />
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
            <p className="text-xs text-muted-foreground">No linked technicians. Link an active technician to a workspace user on the Employees page first.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-order-deadline">Deadline</Label>
          <Input id="edit-order-deadline" type="date" {...register("deadline")} disabled={isSubmitting} />
        </div>
      </div>

      <div className="flex justify-between border-t pt-3">
        <span className="text-lg font-semibold">Total Price</span>
        <span className="tabular-nums">{formatMoney(totalPrice)}</span>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner className="h-4 w-4" /> : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
