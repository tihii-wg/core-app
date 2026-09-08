// import { useState } from "react";
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
// import type { Order, OrderStatus } from "../../lib/types";

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

  // const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // const [isSubmitting, setIsSubmitting] = useState(false);

  const { clients } = useGetClients(searchQuery);
  const { employees } = useGetEmployees();

  // Form state
  // const [formData, setFormData] = useState({
  //   clientId: "",
  //   device: "",
  //   service: "",
  //   description: "",
  //   assignedEmployeeId: "",
  //   deadline: "",
  //   totalPrice: "",
  // });

  // const validateForm = () => {
  //   const errors: Record<string, string> = {};
  //   if (!formData.clientId) errors.clientId = "Client is required";
  //   if (!formData.device.trim()) errors.device = "Device is required";
  //   if (!formData.service) errors.service = "Service is required";
  //   if (!formData.assignedEmployeeId) errors.assignedEmployeeId = "Employee is required";
  //   if (!formData.deadline) errors.deadline = "Deadline is required";
  //   if (!formData.totalPrice || parseFloat(formData.totalPrice) <= 0) {
  //     errors.totalPrice = "Valid price is required";
  //   }
  //   setFormErrors(errors);
  //   return Object.keys(errors).length === 0;
  // };

  // const handleCreateOrder = async () => {
  //   if (!validateForm()) return;

  //   setIsSubmitting(true);
  //   await new Promise((resolve) => setTimeout(resolve, 800));

  //   const client = clients.find((c) => c.id === formData.clientId);
  //   const employee = employees.find((e) => e.id === formData.assignedEmployeeId);

  //   addOrder({
  //     clientId: formData.clientId,
  //     clientName: client?.name || "",
  //     device: formData.device,
  //     service: formData.service,
  //     description: formData.description,
  //     status: "new",
  //     assignedEmployeeId: formData.assignedEmployeeId,
  //     assignedEmployeeName: employee?.name || "",
  //     deadline: formData.deadline,
  //     totalPrice: parseFloat(formData.totalPrice),
  //     paymentStatus: "unpaid",
  //   });

  //   setIsSubmitting(false);
  //   setCreateModalOpen(false);
  //   setFormData({
  //     clientId: "",
  //     device: "",
  //     service: "",
  //     description: "",
  //     assignedEmployeeId: "",
  //     deadline: "",
  //     totalPrice: "",
  //   });
  // };

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
          <Input
            id="device"
            // value={formData.device}
            // onChange={(e) => setFormData({ ...formData, device: e.target.value })}
            {...register("device", { required: "Car is required" })}
            placeholder="Car..."
            className={errors.device ? "border-[#f41f20]" : ""}
          />
          {errors.device && <p className="text-xs text-[#f41f20]">{errors.device.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="service">Service *</Label>
          <ServiceCombobox control={control} services={services} />
          {/* <Controller
            name="service"
            control={control}
            rules={{
              required: "Service is required",
            }}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className={formErrors.service ? "border-[#f41f20]" : ""}>
                  <SelectValue placeholder="Select service" />
                </SelectTrigger>
                <SelectContent>
                  {services
                    .filter((s) => s.status === "active")
                    .map((service) => (
                      <SelectItem key={service.id} value={service.name}>
                        {service.name} - ${service.price}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.service && <p className="text-xs text-[#f41f20]">{errors.service.message}</p>} */}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            {...register("description")}
            // value={formData.description}
            // onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Describe the issue or work needed..."
            rows={3}
          />
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
              <Input
                id="deadline"
                type="date"
                // value={formData.deadline}
                // onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                {...register("deadline")}

                // className={rrors.deadline ? "border-[#f41f20]" : ""}
              />
            </div>
            {/* {formErrors.deadline && <p className="text-xs text-[#f41f20]">{formErrors.deadline}</p>} */}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="totalPrice">Total Price ($) *</Label>
          <Input
            id="totalPrice"
            type="number"
            // value={formData.totalPrice}
            // onChange={(e) => setFormData({ ...formData, totalPrice: e.target.value })}

            {...register("totalPrice")}
            placeholder="0.00"
            // className={formErrors.totalPrice ? "border-[#f41f20]" : ""}
          />
          {/* {formErrors.totalPrice && <p className="text-xs text-[#f41f20]">{formErrors.totalPrice}</p>} */}
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
