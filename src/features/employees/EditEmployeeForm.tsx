import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import type { EditEmployeeFormData, Employee, EmployeeRole } from "../../lib/types";
import { useUpdateEmployee } from "./useUpdateEmployee";

const roles: EmployeeRole[] = ["admin", "manager", "technician", "receptionist"];
const employeesStatuses = ["active", "inactive"] as const;

type EditEmployeeFormProps = {
  employee: Employee;
  onCancel: () => void;
  onUpdated: (employee: Employee) => void;
};

export default function EditEmployeeForm({ employee, onCancel, onUpdated }: EditEmployeeFormProps) {
  const { t } = useTranslation();
  const { mutateAsync: updateEmployee, isPending } = useUpdateEmployee();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditEmployeeFormData>({
    defaultValues: {
      name: employee.name,
      phone: employee.phone ?? "",
      role: employee.role,
      status: employee.status === "inactive" ? "inactive" : "active",
    },
  });

  const busy = isSubmitting || isPending;

  const onSubmit = async (data: EditEmployeeFormData) => {
    try {
      const updated = await updateEmployee({
        employeeId: employee.id,
        name: data.name,
        phone: data.phone,
        role: data.role,
        status: data.status,
      });
      onUpdated(updated);
    } catch {
      return;
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="edit-employee-name">{t("employees.form.fullNameLabel")}</Label>
          <Input
            id="edit-employee-name"
            type="text"
            placeholder={t("employees.form.namePlaceholder")}
            autoFocus
            disabled={busy}
            {...register("name", { required: true })}
            className={errors.name ? "border-destructive focus:border-destructive focus:ring-0" : "hover:border-primary focus:ring-primary"}
          />
          {errors.name && <p className="text-xs text-destructive">{t("employees.form.nameRequired")}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-employee-phone">{t("employees.form.phoneLabel")}</Label>
          <Input
            id="edit-employee-phone"
            placeholder="+1 (555) 000-0000"
            disabled={busy}
            {...register("phone", {
              required: t("employees.form.phoneRequired"),
              pattern: {
                value: /^\+373\d{8}$/,
                message: t("employees.form.phoneInvalid"),
              },
            })}
            className={errors.phone ? "border-destructive focus:border-destructive focus:ring-0" : "hover:border-primary focus:ring-primary"}
          />
          {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-employee-role">{t("employees.form.roleLabel")}</Label>
            <Controller
              name="role"
              control={control}
              rules={{ required: t("employees.form.roleRequired") }}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
                  <SelectTrigger
                    id="edit-employee-role"
                    className={errors.role ? "border-destructive focus:border-destructive focus:ring-0" : "hover:border-primary focus:ring-primary"}
                  >
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
            <Label htmlFor="edit-employee-status">{t("common.status")}</Label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
                  <SelectTrigger id="edit-employee-status">
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

        {employee.profile_id == null ? (
          <p className="text-xs text-muted-foreground">{t("employees.form.editUnlinkedHint")}</p>
        ) : null}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : t("common.saveChanges")}
        </Button>
      </div>
    </form>
  );
}
