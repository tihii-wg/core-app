import { Controller, useForm } from "react-hook-form";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import { Textarea } from "../../ui/Textarea";
import type { EditOrderFormData, Employee, Order } from "../../lib/types";
import { useUpdateOrder } from "./useUpdateOrder";

type EditOrderFormProps = {
  order: Order;
  employees: Employee[];
  onCancel: () => void;
  onUpdated: (order: Order) => void;
};

export default function EditOrderForm({ order, employees, onCancel, onUpdated }: EditOrderFormProps) {
  const { mutateAsync: updateOrder } = useUpdateOrder();

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditOrderFormData>({
    defaultValues: {
      device: order.device,
      carNumber: order.carNumber,
      description: order.description,
      assignedEmployeeId: order.assignedEmployeeId,
      deadline: order.deadline,
    },
  });

  const technicianOptions = employees.filter(
    (employee) => employee.id && (employee.id === order.assignedEmployeeId || (employee.status === "active" && employee.role === "technician")),
  );

  const onSubmit = async (data: EditOrderFormData) => {
    const updatedOrder = await updateOrder({
      orderId: order.id,
      ...data,
    });

    onUpdated(updatedOrder);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="edit-order-device">Device *</Label>
        <Input
          id="edit-order-device"
          {...register("device", { required: "Car is required" })}
          className={errors.device ? "border-[#f41f20]" : ""}
          disabled={isSubmitting}
        />
        {errors.device && <p className="text-xs text-[#f41f20]">{errors.device.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-order-car-number">Car Number *</Label>
        <Input
          id="edit-order-car-number"
          {...register("carNumber", {
            required: "Car number is required",
            setValueAs: (value: string) => value.trim().toUpperCase(),
          })}
          className={errors.carNumber ? "border-[#f41f20]" : ""}
          disabled={isSubmitting}
        />
        {errors.carNumber && <p className="text-xs text-[#f41f20]">{errors.carNumber.message}</p>}
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
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-order-deadline">Deadline</Label>
          <Input id="edit-order-deadline" type="date" {...register("deadline")} disabled={isSubmitting} />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
          {isSubmitting ? <Spinner className="h-4 w-4" /> : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
