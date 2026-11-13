import { useMemo, useState } from "react";
import { Building2, Eye, EyeOff, Users } from "lucide-react";
import { useForm, useWatch, type SubmitHandler } from "react-hook-form";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Label } from "../../ui/Label";
import { Input } from "../../ui/Input";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import { cn } from "../../lib/utils";
import { passwordMinimum } from "../../services/authMessages";
import type { SignUpMode } from "../../services/apiAuth";
import { useSignUp } from "./useSignUp";

type Inputs = {
  companyName: string;
  ownerName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
};

const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

function modeFromSearch(raw: string | null): SignUpMode | null {
  if (raw === "join") return "join";
  if (raw === "create") return "create";
  return null;
}

export default function RegisterForm() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const initialMode = modeFromSearch(searchParams.get("mode"));
  const prefillEmail = useMemo(() => {
    const value = searchParams.get("email");
    return value?.trim() ?? "";
  }, [searchParams]);

  const [mode, setMode] = useState<SignUpMode | null>(initialMode);
  const { mutateAsync, error: signUpError, data: signUpResult } = useSignUp();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const {
    handleSubmit,
    formState: { errors, isSubmitting },
    register,
    control,
    reset,
  } = useForm<Inputs>({
    defaultValues: {
      companyName: "",
      ownerName: "",
      email: prefillEmail,
      phone: "",
      password: "",
      confirmPassword: "",
    },
  });

  const password = useWatch({
    control,
    name: "password",
  });

  const onSubmit: SubmitHandler<Inputs> = async (data) => {
    if (!mode) return;
    try {
      await mutateAsync({
        mode,
        companyName: mode === "create" ? data.companyName : undefined,
        ownerName: data.ownerName,
        email: data.email,
        phone: data.phone?.trim() ? data.phone.trim() : undefined,
        password: data.password,
      });
      reset({
        companyName: "",
        ownerName: "",
        email: mode === "join" ? data.email : "",
        phone: "",
        password: "",
        confirmPassword: "",
      });
    } catch (error) {
      console.log(error);
    }
  };

  if (!mode) {
    return (
      <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold text-foreground">{t("auth.register.modeTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("auth.register.modeDescription")}</p>
        </div>
        <div className="mt-4 grid gap-3">
          <button
            type="button"
            onClick={() => setMode("create")}
            className="flex w-full items-start gap-3 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
          >
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Building2 className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 space-y-1">
              <span className="block text-sm font-medium text-foreground">{t("auth.register.modeCreateTitle")}</span>
              <span className="block text-[13px] text-muted-foreground">{t("auth.register.modeCreateDescription")}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMode("join")}
            className="flex w-full items-start gap-3 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
          >
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Users className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 space-y-1">
              <span className="block text-sm font-medium text-foreground">{t("auth.register.modeJoinTitle")}</span>
              <span className="block text-[13px] text-muted-foreground">{t("auth.register.modeJoinDescription")}</span>
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {mode === "join" ? t("auth.register.modeJoinTitle") : t("auth.register.modeCreateTitle")}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => setMode(null)} disabled={isSubmitting}>
          {t("auth.register.changeMode")}
        </Button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {mode === "create" ? (
          <div className="space-y-1.5">
            <Label htmlFor="companyName" className="text-sm text-foreground">
              {t("auth.register.companyName")}
            </Label>
            <Input
              id="companyName"
              type="text"
              {...register("companyName", { required: mode === "create" })}
              autoFocus={true}
              placeholder={t("auth.register.companyNamePlaceholder")}
              className={errors.companyName ? "focus:border-destructive border-destructive focus:ring-0 " : "h-10 border-input hover:border-primary focus:ring-primary"}
              disabled={isSubmitting}
            />
            {errors.companyName && <p className="text-xs text-destructive">{t("auth.register.companyNameRequired")}</p>}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="ownerName" className="text-sm text-foreground">
            {mode === "join" ? t("auth.register.fullName") : t("auth.register.ownerName")}
          </Label>
          <Input
            id="ownerName"
            type="text"
            {...register("ownerName", { required: true })}
            autoFocus={mode === "join"}
            placeholder={mode === "join" ? t("auth.register.fullNamePlaceholder") : t("auth.register.ownerNamePlaceholder")}
            className="h-10 border-input hover:border-primary focus:ring-primary"
            disabled={isSubmitting}
          />
          {errors.ownerName && (
            <p className="text-xs text-destructive">
              {mode === "join" ? t("auth.register.fullNameRequired") : t("auth.register.ownerNameRequired")}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-sm text-foreground">
            {t("auth.fields.email")}
          </Label>
          <Input
            id="email"
            type="text"
            {...register(`email`, { required: true })}
            placeholder={t("auth.fields.emailPlaceholder")}
            className="h-10 border-input hover:border-primary hover:ring-primary"
            disabled={isSubmitting}
          />
          {errors.email && <p className="text-xs text-destructive">{t("auth.validation.emailRequired")}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="phone" className="text-sm text-foreground">
            {t("auth.register.phone")}
            {mode === "join" ? (
              <span className="ml-1 font-normal text-muted-foreground">({t("common.optional")})</span>
            ) : null}
          </Label>
          <Input
            id="phone"
            type="text"
            {...register(`phone`, {
              required: mode === "create",
              validate: (value) => {
                const trimmed = value?.trim() ?? "";
                if (!trimmed) return mode === "create" ? t("auth.register.phoneRequired") : true;
                return PHONE_PATTERN.test(trimmed) || t("auth.register.phoneInvalid");
              },
            })}
            placeholder={t("auth.register.phonePlaceholder")}
            className={cn("h-10 border-input hover:border-primary hover:ring-primary", errors.phone && "border-destructive")}
            disabled={isSubmitting}
          />
          {errors.phone && (
            <p className="text-xs text-destructive">
              {typeof errors.phone.message === "string" ? errors.phone.message : t("auth.register.phoneRequired")}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-sm text-foreground">
            {t("auth.fields.password")}
          </Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              {...register("password", {
                required: t("auth.validation.passwordRequired"),
                minLength: {
                  value: passwordMinimum,
                  message: t("auth.validation.passwordMinLength", { count: passwordMinimum }),
                },
              })}
              placeholder={t("auth.register.passwordPlaceholder")}
              className="h-10 pr-10 border-input hover:border-primary  hover:ring-primary"
              disabled={isSubmitting}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? t("auth.fields.hidePassword") : t("auth.fields.showPassword")}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword" className="text-sm text-foreground">
            {t("auth.register.confirmPassword")}
          </Label>
          <div className="relative">
            <Input
              id="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              {...register("confirmPassword", {
                required: t("auth.register.confirmPasswordRequired"),
                validate: (value) => value === password || t("auth.register.passwordsMismatch"),
              })}
              placeholder={t("auth.register.confirmPasswordPlaceholder")}
              className="h-10 pr-10 border-input hover:border-primary focus:ring-primary"
              disabled={isSubmitting}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showConfirmPassword ? t("auth.fields.hidePassword") : t("auth.fields.showPassword")}
            >
              {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
        </div>

        {signUpResult?.needsEmailConfirmation && (
          <p className="text-sm text-muted-foreground">
            {mode === "join" ? t("auth.register.confirmEmailJoin") : t("auth.register.confirmEmail")}
          </p>
        )}
        {signUpError && <p className="text-sm text-destructive">{`${signUpError?.message}`}</p>}

        <Button type="submit" disabled={isSubmitting} size="lg" className="w-full">
          {isSubmitting ? <Spinner className="h-4 w-4" /> : t("auth.register.submit")}
        </Button>
      </form>
    </div>
  );
}
