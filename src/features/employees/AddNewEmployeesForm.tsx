// import { useState } from "react";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import type { AddNewEmployeesFormData, CreateEmployeeData, CreateMadalProps, EmployeeRoleOption } from "../../lib/types";
import { Controller, useForm } from "react-hook-form";
import { useGetProfile } from "../profiles/useGetProfile";
import { profileDisplayName } from "../profiles/profileName";
import { useGetWorkspaceMembers } from "../workspaces/useGetWorkspaceMembers";
import { workspaceRoleLabel } from "../workspaces/workspaceRoles";
import useCreateNewEmployee from "./useCreateNewEmployee";
import useGetEmployees from "./useGetEmployees";

const NOT_LINKED = "not-linked";

const roles: EmployeeRoleOption[] = [
  // { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "technician", label: "Technician" },
  { value: "receptionist", label: "Receptionict" },
];

const employeesStatuses = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const;

export default function AddNewEmployeesForm({ setCreateModalOpen }: CreateMadalProps) {
  const { mutateAsync: createEmployee } = useCreateNewEmployee();
  const { members, error: membersError } = useGetWorkspaceMembers();
  const { employees } = useGetEmployees();
  const linkedUserIds = new Set((employees ?? []).map((employee) => employee.profile_id).filter(Boolean));
  const linkableMembers = (members ?? []).filter((member) => !linkedUserIds.has(member.userId));

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
      profile_id: null,
    },
  });
  const { data: profile } = useGetProfile();

  const onSubmit = async (data: AddNewEmployeesFormData) => {
    const currentProfile = profile;

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
      profile_id: data.profile_id ?? null,
    };
    try {
      await createEmployee(newEmployeeData);
    } catch {
      return;
    }
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
            className={errors.name ? "focus:border-destructive border-destructive focus:ring-0 " : "hover:border-primary focus:ring-primary"}
          />
          {errors.name && <p className="text-xs text-destructive">Name is Reqiured</p>}
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
              className={errors.email ? "focus:border-destructive border-destructive focus:ring-0 " : "hover:border-primary focus:ring-primary"}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
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
                  message: "Phone must be in firmat +37300000000",
                },
              })}
              className={errors.phone ? "focus:border-destructive border-destructive focus:ring-0 " : "hover:border-primary focus:ring-primary"}
            />
            {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
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
                  <SelectTrigger id="role" className={errors.role ? "focus:border-destructive border-destructive focus:ring-0 " : "hover:border-primary focus:ring-primary"}>
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
            {errors.role && <p className="text-xs text-destructive">{errors.role.message}</p>}
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

        <div className="space-y-1.5">
          <Label htmlFor="profile_id">Linked user</Label>
          <Controller
            name="profile_id"
            control={control}
            render={({ field }) => (
              <Select value={field.value ?? NOT_LINKED} onValueChange={(value) => field.onChange(value === NOT_LINKED ? null : value)} disabled={isSubmitting}>
                <SelectTrigger id="profile_id">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NOT_LINKED}>Not linked</SelectItem>
                  {linkableMembers.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {profileDisplayName(member.fullName, member.email ?? "Workspace member")} ({workspaceRoleLabel(member.role)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {membersError ? (
            <p className="text-xs text-destructive">{membersError instanceof Error ? membersError.message : "Workspace members could not be loaded"}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Link the workspace account this employee signs in with. Only linked employees can be assigned to orders.</p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2">{errors.root && <p className="text-sm text-destructive mr-auto">{errors.root.message}</p>}</div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={handleReset} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner className="h-4 w-4" /> : "Add Employee"}
        </Button>
      </div>
    </form>
  );
}
