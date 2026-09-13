import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { useGetClients } from "../clients/useGetClients";
import { useApp } from "../../lib/appContext";
import { Textarea } from "../../ui/Textarea";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import useGetEmployees from "../employees/useGetEmployees";
import { Controller, useForm } from "react-hook-form";
import type { addNewOrderFormData } from "../../lib/types";
import ServiceCombobox from "./ServiceCombobox";

export default function AddNewOrderForm({ setCreateModalOpen, searchQuery }) {
  const { services } = useApp();

  const {
    control,
    handleSubmit,
    register,
    formState: { errors, isSubmitting },
  } = useForm<addNewOrderFormData>({
    defaultValues: {
      clientId: "",
      device: "",
      serviceName: "",
      description: "",
      assignedEmployeeId: "",
      deadline: "",
    },
  });

  const { clients } = useGetClients(searchQuery);
  const { employees } = useGetEmployees();

  function handleCancel() {
    setCreateModalOpen(false);
  }

  const onSubmit = (data) => {
    console.log(data);
    setCreateModalOpen(false);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="clientId">Client *</Label>
          <Controller
            name="clientId"
            control={control}
            rules={{
              required: "Client is required",
            }}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className={errors.clientId ? "border-[#f41f20]" : ""}>
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {clients?.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.clientId && <p className="text-xs text-[#f41f20]">{errors.clientId.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="device">Device *</Label>
          <Input id="device" {...register("device", { required: "Car is required" })} placeholder="Car..." className={errors.device ? "border-[#f41f20]" : ""} />
          {errors.device && <p className="text-xs text-[#f41f20]">{errors.device.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="service">Service *</Label>
          <ServiceCombobox control={control} services={services} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" {...register("description")} placeholder="Describe the issue or work needed..." rows={3} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="assignedEmployeeId">Assigned Employee *</Label>
            <Controller
              name="assignedEmployeeId"
              control={control}
              rules={{
                required: "Assigned employee is required",
              }}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className={errors.assignedEmployeeId ? "border-[#f41f20]" : ""}>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees
                      ?.filter((e) => e.status === "active" && e.role === "technician")
                      .map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          {emp.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.assignedEmployeeId && <p className="text-xs text-[#f41f20]">{errors.assignedEmployeeId.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="deadline">Deadline</Label>
            <div className="relative">
              <Input id="deadline" type="date" {...register("deadline")} />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="totalPrice">Total Price ($) *</Label>
          <Input id="totalPrice" type="number" {...register("totalPrice")} placeholder="0.00" />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" type="button" onClick={handleCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
          {isSubmitting ? <Spinner className="h-4 w-4" /> : "Create Order"}
        </Button>
      </div>
    </form>
  );
}
