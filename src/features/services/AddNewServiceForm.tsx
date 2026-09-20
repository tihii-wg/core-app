import { Controller, useForm } from "react-hook-form";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import { Textarea } from "../../ui/Textarea";
// import { useMutation } from "@tanstack/react-query";
import useCreateNewService from "./useCreateNewService";
import type { addNewServiceFormData } from "../../lib/types";
import ServiceCombobox from "../orders/ServiceCombobox";
import useGetServices from "./useGetServices";

export default function AddNewServiceForm({ setCreateModalOpen }) {
  const { mutate } = useCreateNewService();
  const { services } = useGetServices();

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
          <Label htmlFor="serviceName">Service Name *</Label>
          <Controller
            name="serviceName"
            control={control}
            rules={{
              required: "Service is required",
            }}
            render={({ field }) => <ServiceCombobox services={services} value={field.value} onChange={field.onChange} />}
          />

          {/* <Input
            id="serviceName"
            {...register("serviceName", { required: true })}
            // value={formData.name}
            // onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Screen Replacement"
            className={errors.serviceName ? "border-[#f41f20]" : ""}
          /> */}
          {errors.serviceName && <p className="text-xs text-[#f41f20]">Service name is required</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
              <SelectTrigger className={formErrors.category ? "border-[#f41f20]" : ""}>
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
            {formErrors.category && <p className="text-xs text-[#f41f20]">{formErrors.category}</p>}
          </div> */}

          <div className="space-y-1.5">
            <Label htmlFor="status">Status</Label>
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
              // value={formData.price}
              // onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              placeholder="0.00"
              className={errors.price ? "border-[#f41f20]" : ""}
            />
            {errors.price && <p className="text-xs text-[#f41f20]">{errors.price.message}</p>}
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
              className={formErrors.duration ? "border-[#f41f20]" : ""}
            /> */}
          {/* {errors.duration && <p className="text-xs text-[#f41f20]">{formErrors.duration}</p>}
          </div> */}

          {/* </div> */}

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" {...register("description")} placeholder="Brief description of this service..." rows={3} />
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
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
            {isSubmitting ? <Spinner className="h-4 w-4" /> : "Add Service"}
          </Button>
        </div>
      </div>
    </form>
  );
}
