import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} type={visible ? "text" : "password"} autoComplete={autoComplete} disabled={disabled} className={error ? "border-destructive pr-10" : "pr-10"} {...registration} />
        <button type="button" onClick={() => setVisible((current) => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={visible ? t("settings.security.password.hide", { label }) : t("settings.security.password.show", { label })}>
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function ChangePasswordForm() {
  const { t } = useTranslation();
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
        <CardTitle>{t("settings.security.password.title")}</CardTitle>
        <CardDescription>{t("settings.security.password.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="max-w-md space-y-4">
          <PasswordField
            id="current-password"
            label={t("settings.security.password.current")}
            autoComplete="current-password"
            disabled={saving}
            error={errors.currentPassword?.message}
            registration={register("currentPassword", { required: t("settings.security.password.validation.currentRequired") })}
          />
          <PasswordField
            id="new-password"
            label={t("settings.security.password.new")}
            autoComplete="new-password"
            disabled={saving}
            error={errors.newPassword?.message}
            registration={register("newPassword", {
              required: t("settings.security.password.validation.newRequired"),
              minLength: { value: passwordMinimum, message: t("settings.security.password.validation.tooShort", { count: passwordMinimum }) },
            })}
          />
          <PasswordField
            id="confirm-password"
            label={t("settings.security.password.confirm")}
            autoComplete="new-password"
            disabled={saving}
            error={errors.confirmPassword?.message}
            registration={register("confirmPassword", {
              required: t("settings.security.password.validation.confirmRequired"),
              validate: (value) => value === newPassword || t("settings.security.password.validation.mismatch"),
            })}
          />
          <Button type="submit" disabled={saving}>
            {saving ? t("settings.security.password.submitting") : t("settings.security.password.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
