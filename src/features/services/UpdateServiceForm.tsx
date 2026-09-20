import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";

import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Textarea } from "../../ui/Textarea";
import { Spinner } from "../../ui/Spinner";

import type { EditServiceFormData, Service } from "../../lib/types";
import useUpdateService from "./useUpdateService";

type EditServiceFormProps = {
  service: Service;
  setEditModalOpen: (open: boolean) => void;
};

export default function UpdateServiceForm({ service, setEditModalOpen }: EditServiceFormProps) {
  const { mutate } = useUpdateService();

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
   
    const updatedService = {
      serviceId: service.id,
      ...data,
    };

    mutate(updatedService);

    setEditModalOpen(false);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-4 py-4">
        {/* Service name */}
        <div className="space-y-1.5">
          <Label htmlFor="serviceName">Service Name</Label>

          <Input
            id="serviceName"
            {...register("serviceName", {
              required: "Service name is required",
            })}
            className={errors.serviceName ? "border-[#f41f20]" : ""}
          />

          {errors.serviceName && <p className="text-xs text-[#f41f20]">{errors.serviceName.message}</p>}
        </div>

        {/* Status + Price */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Status</Label>

            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>

                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="price">Price ($) *</Label>

            <Input
              id="price"
              type="number"
              step="0.01"
              {...register("price", {
                valueAsNumber: true,
                required: "Price is required",
                min: {
                  value: 0,
                  message: "Price cannot be negative",
                },
              })}
              className={errors.price ? "border-[#f41f20]" : ""}
            />

            {errors.price && <p className="text-xs text-[#f41f20]">{errors.price.message}</p>}
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>

          <Textarea id="description" {...register("description")} rows={3} />
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => setEditModalOpen(false)}>
            Cancel
          </Button>

          <Button type="submit" disabled={isSubmitting} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
            {isSubmitting ? <Spinner className="h-4 w-4" /> : "Save Changes"}
          </Button>
        </div>
      </div>
    </form>
  );
}
