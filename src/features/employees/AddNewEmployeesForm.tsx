// import { useState } from "react";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import type { AddNewEmployeesFormData, CreateEmployeeData, CreateMadalProps, EmployeeRole } from "../../lib/types";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useGetProfile } from "../profiles/useGetProfile";
import { profileDisplayName } from "../profiles/profileName";
import { useGetWorkspaceMembers } from "../workspaces/useGetWorkspaceMembers";
import { workspaceRoleLabel } from "../workspaces/workspaceRoles";
import useCreateNewEmployee from "./useCreateNewEmployee";
import useGetEmployees from "./useGetEmployees";

const NOT_LINKED = "not-linked";

const roles: EmployeeRole[] = ["admin", "manager", "technician", "receptionist"];

const employeesStatuses = ["active", "inactive"] as const;

export default function AddNewEmployeesForm({ setCreateModalOpen }: CreateMadalProps) {
  const { t } = useTranslation();
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
        message: t("employees.form.profileNotFound"),
      });
      return;
    }

    if (!currentProfile.active_workspace_id) {
      setError("root", {
        message: t("employees.errors.noActiveWorkspace"),
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
          <Label htmlFor="name">{t("employees.form.fullNameLabel")}</Label>
          <Input
            id="name"
            type="text"
            placeholder={t("employees.form.namePlaceholder")}
            autoFocus={true}
            disabled={isSubmitting}
            {...register("name", { required: true })}
            className={errors.name ? "focus:border-destructive border-destructive focus:ring-0 " : "hover:border-primary focus:ring-primary"}
          />
          {errors.name && <p className="text-xs text-destructive">{t("employees.form.nameRequired")}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("employees.form.emailLabel")}</Label>
            <Input
              id="email"
              type="email"
              autoFocus={true}
              placeholder="email@company.com"
              disabled={isSubmitting}
              {...register("email", {
                required: t("employees.form.emailRequired"),
                pattern: {
                  value: /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
                  message: t("employees.form.emailInvalid"),
                },
              })}
              className={errors.email ? "focus:border-destructive border-destructive focus:ring-0 " : "hover:border-primary focus:ring-primary"}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">{t("employees.form.phoneLabel")}</Label>
            <Input
              id="phone"
              autoFocus={true}
              placeholder="+1 (555) 000-0000"
              disabled={isSubmitting}
              {...register("phone", {
                required: t("employees.form.phoneRequired"),
                pattern: {
                  value: /^\+373\d{8}$/,
                  message: t("employees.form.phoneInvalid"),
                },
              })}
              className={errors.phone ? "focus:border-destructive border-destructive focus:ring-0 " : "hover:border-primary focus:ring-primary"}
            />
            {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="role">{t("employees.form.roleLabel")}</Label>
            <Controller
              name="role"
              control={control}
              rules={{
                required: t("employees.form.roleRequired"),
              }}
              render={({ field }) => (
                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                  <SelectTrigger id="role" className={errors.role ? "focus:border-destructive border-destructive focus:ring-0 " : "hover:border-primary focus:ring-primary"}>
                    <SelectValue placeholder={t("employees.form.rolePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {t(`employees.form.roleOptions.${role}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.role && <p className="text-xs text-destructive">{errors.role.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>{t("common.status")}</Label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {employeesStatuses.map((status) => (
                      <SelectItem key={status} value={status}>
                        {t(`employees.statuses.${status}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile_id">{t("employees.form.linkedUserLabel")}</Label>
          <Controller
            name="profile_id"
            control={control}
            render={({ field }) => (
              <Select value={field.value ?? NOT_LINKED} onValueChange={(value) => field.onChange(value === NOT_LINKED ? null : value)} disabled={isSubmitting}>
                <SelectTrigger id="profile_id">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NOT_LINKED}>{t("employees.form.notLinked")}</SelectItem>
                  {linkableMembers.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {t("employees.form.memberOption", {
                        name: profileDisplayName(member.fullName, member.email ?? t("employees.form.memberFallbackName")),
                        role: workspaceRoleLabel(member.role),
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {membersError ? (
            <p className="text-xs text-destructive">{membersError instanceof Error ? membersError.message : t("employees.form.membersLoadError")}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t("employees.form.linkedUserHint")}</p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2">{errors.root && <p className="text-sm text-destructive mr-auto">{errors.root.message}</p>}</div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={handleReset} disabled={isSubmitting}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner className="h-4 w-4" /> : t("employees.addEmployee")}
        </Button>
      </div>
    </form>
  );
}
