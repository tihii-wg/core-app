import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { useGetClients } from "../clients/useGetClients";
import { Textarea } from "../../ui/Textarea";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import useGetEmployees from "../employees/useGetEmployees";
import { Controller, useForm, useFieldArray } from "react-hook-form";
import type { addNewOrderFormData } from "../../lib/types";
import ServiceCombobox from "./ServiceCombobox";
import useGetServices from "../services/useGetServices";
import ClientCombobox from "../clients/ClientCombobox";
import { useState } from "react";
import { useCreateNewClient } from "../clients/useCreateNewClient";
import { useGetProfile } from "../profiles/useGetProfile";

export default function AddNewOrderForm({ setCreateModalOpen, searchQuery }) {
  const { services } = useGetServices();
  const { data: profile } = useGetProfile();
  const { clients } = useGetClients(searchQuery);
  const { employees } = useGetEmployees();
  const { mutate: createClient } = useCreateNewClient();
  // console.log(clients);
  const [clientName, setClientName] = useState("");

  const activeServices = services?.filter((service) => service.status === "active");

  const {
    control,
    handleSubmit,
    register,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<addNewOrderFormData>({
    defaultValues: {
      clientId: "",
      device: "",
      services: [],
      description: "",
      assignedEmployeeId: "",
      deadline: "",
    },
  });

  const {
    fields: serviceField,
    append: serviceAppend,
    remove: serviceRemove,
  } = useFieldArray({
    control,
    name: "services",
    rules: {
      required: "Service is required",
      minLength: {
        value: 1,
        message: "Service is required",
      },
    },
  });

  function handleCancel() {
    setCreateModalOpen(false);
  }

  const onSubmit = (data: addNewOrderFormData) => {
    console.log(data);
    console.log(clientName);
    console.log(profile);
    setCreateModalOpen(false);

    // try {
    //   let clientId = data.clientId;

    //   // Новый клиент
    //   if (!clientId) {
    //     if (!clientName.trim()) {
    //       console.error("Client is required");
    //       return;
    //     }

    //     console.log("Creating new client:", clientName);

    //     // const newClient = createClient({
    //     //     name: clientName.trim(),
    //     //   });

    //     //   clientId = newClient.id;

    //     //   console.log("New client ID:", clientId);
    //     }

    //     // console.log("Final client ID:", clientId);

    //     // Здесь создаём заказ
    //     // await createOrder({
    //     //   ...data,
    //     //   clientId,
    //     // });

    //     //   setCreateModalOpen(false);
    //     } catch (error) {
    //     //   console.error("CREATE ORDER ERROR:", error);
    //   }
  };

  const totalPrice = serviceField.reduce((total, service) => total + (service.price ?? 0) * service.quantity, 0);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex w-full min-w-0 max-h-[80vh] flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto py-4 pr-2">
        <div className="space-y-1.5">
          <Label htmlFor="clientId">Client *</Label>
          <Controller
            name="clientId"
            control={control}
            render={({ field }) => (
              <ClientCombobox
                clients={clients ?? []}
                value={clientName}
                onChange={(value) => {
                  setClientName(value);

                  field.onChange("");
                }}
                onSelect={(client) => {
                  setClientName(client.name);
                  field.onChange(client.id);
                }}
              />
            )}
          />

          {errors.clientId && <p className="text-xs text-[#f41f20]">{errors.clientId.message}</p>}
          {/* <Controller
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
          {errors.clientId && <p className="text-xs text-[#f41f20]">{errors.clientId.message}</p>} */}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="device">Device *</Label>
          <Input id="device" {...register("device", { required: "Car is required" })} placeholder="Car..." className={errors.device ? "border-[#f41f20]" : ""} />
          {errors.device && <p className="text-xs text-[#f41f20]">{errors.device.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label>Service *</Label>

          <ServiceCombobox
            services={activeServices}
            onSelect={(service) => {
              const alreadyExists = serviceField.some((field) => field.serviceId === service.id);

              if (alreadyExists) return;

              serviceAppend({
                serviceId: service.id,
                serviceName: service.service_name,
                price: service.service_price ?? 0,
                quantity: 1,
              });
              clearErrors("services");
            }}
          />
          {errors.services?.root?.message && <p className="text-xs text-[#f41f20]">{errors.services.root.message}</p>}

          {serviceField.length > 0 && (
            <div className="space-y-2">
              {serviceField.map((field, index) => (
                <div key={field.id} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="font-medium">{field.serviceName}</p>
                    <p className="text-sm text-gray-500">${field.price}</p>
                  </div>
                  <Button type="button" variant="outline" onClick={() => serviceRemove(index)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
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

        <div className=" flex justify-between border-t pt-3">
          <span className="text-lg font-semibold">Total Price</span>
          <span>${totalPrice.toFixed(2)}</span>
        </div>
      </div>

      <div className="flex w-full  shrink-0 justify-end gap-2 border-t bg-white pt-3">
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
