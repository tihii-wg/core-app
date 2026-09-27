import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { passwordMinimum } from "../../services/authMessages";
import { useChangePassword } from "../auth/useChangePassword";

type PasswordFormValues = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

function PasswordField({
  id,
  label,
  autoComplete,
  error,
  registration,
  disabled,
}: {
  id: string;
  label: string;
  autoComplete: string;
  error?: string;
  registration: ReturnType<ReturnType<typeof useForm<PasswordFormValues>>["register"]>;
  disabled: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} type={visible ? "text" : "password"} autoComplete={autoComplete} disabled={disabled} className={error ? "border-[#f41f20] pr-10" : "pr-10"} {...registration} />
        <button type="button" onClick={() => setVisible((current) => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#939699] hover:text-[#282e33]" aria-label={visible ? `Hide ${label}` : `Show ${label}`}>
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && <p className="text-xs text-[#f41f20]">{error}</p>}
    </div>
  );
}

export function ChangePasswordForm() {
  const { mutateAsync, isPending } = useChangePassword();
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<PasswordFormValues>({
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  const newPassword = useWatch({ control, name: "newPassword" });
  const saving = isPending || isSubmitting;

  async function onSubmit(values: PasswordFormValues) {
    try {
      await mutateAsync({ currentPassword: values.currentPassword, newPassword: values.newPassword });
      reset();
    } catch {
      return;
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Update your password to keep your account secure</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="max-w-md space-y-4">
          <PasswordField
            id="current-password"
            label="Current password"
            autoComplete="current-password"
            disabled={saving}
            error={errors.currentPassword?.message}
            registration={register("currentPassword", { required: "Current password is required" })}
          />
          <PasswordField
            id="new-password"
            label="New password"
            autoComplete="new-password"
            disabled={saving}
            error={errors.newPassword?.message}
            registration={register("newPassword", {
              required: "New password is required",
              minLength: { value: passwordMinimum, message: `Password must be at least ${passwordMinimum} characters` },
            })}
          />
          <PasswordField
            id="confirm-password"
            label="Confirm new password"
            autoComplete="new-password"
            disabled={saving}
            error={errors.confirmPassword?.message}
            registration={register("confirmPassword", {
              required: "Confirm password is required",
              validate: (value) => value === newPassword || "Passwords do not match",
            })}
          />
          <Button type="submit" disabled={saving}>
            {saving ? "Changing password..." : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
