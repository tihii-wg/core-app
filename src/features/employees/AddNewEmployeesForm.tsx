// import { useState } from "react";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import type { AddNewEmployeesFormData, CreateEmployeeData, EmployeeRoleOption } from "../../lib/types";
import { Controller, useForm } from "react-hook-form";
import { useGetProfiles } from "../profiles/useGetProfiles";
import useCreateNewEmployee from "./useCreateNewEmployee";

const roles: EmployeeRoleOption[] = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "technician", label: "Technician" },
  { value: "receptionist", label: "Receptionict" },
];

const employeesStatuses = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const;

export default function AddNewEmployeesForm({ setCreateModalOpen }) {
  const { mutate } = useCreateNewEmployee();

  const {
    register,
    reset,
    control,
    setError,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AddNewEmployeesFormData>({
    defaultValues: {
      role: "",
      status: "active",
    },
  });
  const { data: profile } = useGetProfiles();

  const onSubmit = (data: AddNewEmployeesFormData) => {
    const currentProfile = profile[0];

    if (!currentProfile) {
      setError("root", {
        message: "Profile not found",
      });
      return;
    }

    if (!currentProfile.active_workspace_id) {
      setError("root", {
        message: "No active workspace",
      });
      return;
    }

    const newEmployeeData: CreateEmployeeData = {
      ...data,
      workspace_id: currentProfile.active_workspace_id,
      profile_id: currentProfile.id,
    };
    mutate(newEmployeeData);
    setCreateModalOpen(false);
  };

  function handleReset() {
    reset();
    setCreateModalOpen(false);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Full Name *</Label>
          <Input
            id="name"
            type="text"
            placeholder="Employee name"
            autoFocus={true}
            disabled={isSubmitting}
            {...register("name", { required: true })}
            className={errors.name ? "focus:border-[#f41f20] border-[#f41f20] focus:ring-0 " : "hover:border-[#1973e1] focus:ring-[#1973e1]"}
          />
          {errors.name && <p className="text-xs text-[#f41f20]">Name is Reqiured</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              autoFocus={true}
              placeholder="email@company.com"
              disabled={isSubmitting}
              {...register("email", {
                required: "Email is required",
                pattern: {
                  value: /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
                  message: "Invalid email adress",
                },
              })}
              className={errors.email ? "focus:border-[#f41f20] border-[#f41f20] focus:ring-0 " : "hover:border-[#1973e1] focus:ring-[#1973e1]"}
            />
            {errors.email && <p className="text-xs text-[#f41f20]">{errors.email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone *</Label>
            <Input
              id="phone"
              autoFocus={true}
              placeholder="+1 (555) 000-0000"
              disabled={isSubmitting}
              {...register("phone", {
                required: "Phone is required",
                pattern: {
                  value: /^\+373\d{8}$/,
                  message: "Phone must be in firmat +373000000",
                },
              })}
              className={errors.phone ? "focus:border-[#f41f20] border-[#f41f20] focus:ring-0 " : "hover:border-[#1973e1] focus:ring-[#1973e1]"}
            />
            {errors.phone && <p className="text-xs text-[#f41f20]">{errors.phone.message}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="role">Role *</Label>
            <Controller
              name="role"
              control={control}
              rules={{
                required: "Role is required",
              }}
              render={({ field }) => (
                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                  <SelectTrigger id="role" className={errors.role ? "focus:border-[#f41f20] border-[#f41f20] focus:ring-0 " : "hover:border-[#1973e1] focus:ring-[#1973e1]"}>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role.value} value={role.value}>
                        {role.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.role && <p className="text-xs text-[#f41f20]">{errors.role.message}</p>}
          </div>

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
                    {employeesStatuses.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">{errors.root && <p className="text-sm text-red-500 mr-auto">{errors.root.message}</p>}</div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={handleReset} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
          {isSubmitting ? <Spinner className="h-4 w-4" /> : "Add Employee"}
        </Button>
      </div>
    </form>
  );
}
