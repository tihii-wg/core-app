import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { useForm, useWatch, type SubmitHandler } from "react-hook-form";
import { Label } from "../../ui/Label";
import { Input } from "../../ui/Input";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import { useTranslation } from "react-i18next";
import { passwordMinimum } from "../../services/authMessages";
import { useSignUp } from "./useSignUp";

type Inputs = {
  companyName: string;
  ownerName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
};

export default function RegisterForm() {
  const { t } = useTranslation();
  const { mutateAsync, error: signUpError, data: signUpResult } = useSignUp();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  // const [authType, setAuthType] = useState<"email" | "phone">("email");

  const {
    handleSubmit,
    formState: { errors, isSubmitting },
    register,
    control,
    reset,
  } = useForm<Inputs>();

  const password = useWatch({
    control,
    name: "password",
  });

  const onSubmit: SubmitHandler<Inputs> = async (data) => {
    try {
      await mutateAsync({
        companyName: data.companyName,
        ownerName: data.ownerName,
        email: data.email,
        phone: data.phone,
        password: data.password,
      });
      reset();
    } catch (error) {
      console.log(error);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="companyName" className="text-sm text-foreground">
            {t("auth.register.companyName")}
          </Label>
          <Input
            id="companyName"
            type="text"
            {...register("companyName", { required: true })}
            autoFocus={true}
            placeholder={t("auth.register.companyNamePlaceholder")}
            className={errors.companyName ? "focus:border-destructive border-destructive focus:ring-0 " : "h-10 border-input hover:border-primary focus:ring-primary"}
            disabled={isSubmitting}
          />
          {errors.companyName && <p className="text-xs text-destructive">{t("auth.register.companyNameRequired")}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ownerName" className="text-sm text-foreground">
            {t("auth.register.ownerName")}
          </Label>
          <Input
            id="ownerName"
            type="text"
            {...register("ownerName", { required: true })}
            placeholder={t("auth.register.ownerNamePlaceholder")}
            className="h-10 border-input hover:border-primary focus:ring-primary"
            disabled={isSubmitting}
          />
          {errors.ownerName && <p className="text-xs text-destructive">{t("auth.register.ownerNameRequired")}</p>}
        </div>

        {/* <div className="space-y-1.5">
          <Label htmlFor="email" className="text-sm text-foreground">
            <Button className={authType === "email" ? "hover:bg-border-strong text-primary" : "hover:bg-border-strong"} type="button" variant="secondary" size="sm" onClick={() => setAuthType("email")}>
              Email
            </Button>{" "}
            or{" "}
            <Button className={authType === "phone" ? "hover:bg-border-strong text-primary" : "hover:bg-border-strong"} type="button" variant="secondary" size="sm" onClick={() => setAuthType("phone")}>
              Phone
            </Button>
          </Label>
          {authType === "email" ? (
            <Input
              id="email"
              type="text"
              {...register(`email`, { required: true })}
              placeholder="Enter your email"
              className="h-10 border-input hover:border-primary hover:ring-primary"
              disabled={isSubmitting}
            />
          ) : (
            <Input
              id="phone"
              type="text"
              {...register(`phone`, {
                required: true,
                pattern: /^\+[1-9]\d{7,14}$/,
              })}
              placeholder="Enter your phone number  +373 00 000 000"
              className="h-10 border-input hover:border-primary hover:ring-primary"
              disabled={isSubmitting}
            />
          )}

          {errors.email && <p className="text-xs text-destructive">Email or phone is required</p>}
        </div> */}

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
        <div>
          <Label htmlFor="phone" className="text-sm text-foreground">
            {t("auth.register.phone")}
          </Label>

          <Input
            id="phone"
            type="text"
            {...register(`phone`, {
              required: true,
              pattern: /^\+[1-9]\d{7,14}$/,
            })}
            placeholder={t("auth.register.phonePlaceholder")}
            className="h-10 border-input hover:border-primary hover:ring-primary"
            disabled={isSubmitting}
          />
          {errors.phone && <p className="text-xs text-destructive">{t("auth.register.phoneRequired")}</p>}
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
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={showPassword ? t("auth.fields.hidePassword") : t("auth.fields.showPassword")}>
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
            <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={showConfirmPassword ? t("auth.fields.hidePassword") : t("auth.fields.showPassword")}>
              {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
        </div>

        {signUpResult?.needsEmailConfirmation && <p className="text-sm text-muted-foreground">{t("auth.register.confirmEmail")}</p>}
        {signUpError && <p className="text-sm text-destructive">{`${signUpError?.message}`}</p>}

        <Button type="submit" disabled={isSubmitting} size="lg" className="w-full">
          {isSubmitting ? <Spinner className="h-4 w-4" /> : t("auth.register.submit")}
        </Button>
      </form>
    </div>
  );
}
