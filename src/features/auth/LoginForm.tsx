import { useState } from "react";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Spinner } from "../../ui/Spinner";
import { useLogin } from "./useLogIn";
import { useLogOut } from "./useLogOut";
import { useUser } from "./useUser";
import { useMfaStatus, useSessionMfa } from "./useMfa";
import { LoginMfaStep } from "./LoginMfaStep";
import { useForm } from "react-hook-form";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { passwordMinimum } from "../../services/authMessages";

type LoginValues = {
  email: string;
  password: string;
};

export default function LoginForm() {
  const { t } = useTranslation();
  const { login, isLoading, finishLogin } = useLogin();
  const { logOut } = useLogOut();
  const { isAuthenticated } = useUser();
  const { needsMfa } = useSessionMfa(isAuthenticated);
  const mfaStatus = useMfaStatus(needsMfa);
  const [factorId, setFactorId] = useState<string | null>(null);
  const {
    register,
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>();

  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const activeFactorId = factorId ?? (needsMfa ? mfaStatus.data?.factorId ?? null : null);

  async function onSubmit(data: LoginValues) {
    setLoginError(null);
    try {
      const result = await login(data);
      if (result.mfaRequired) {
        setFactorId(result.factorId);
        reset({ email: data.email, password: "" });
        return;
      }
      reset();
    } catch (caught) {
      setLoginError(caught instanceof Error && caught.message ? caught.message : t("auth.errors.invalidCredentials"));
    }
  }

  if (needsMfa && mfaStatus.isLoading) return <Spinner className="mx-auto h-5 w-5" />;

  if (activeFactorId) {
    return (
      <LoginMfaStep
        factorId={activeFactorId}
        onVerified={finishLogin}
        onBack={() => {
          setFactorId(null);
          void logOut();
        }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-sm text-foreground">
          {t("auth.fields.email")}
        </Label>
        <Input
          id="email"
          type="text"
          {...register("email", {
            required: t("auth.validation.emailRequired"),
            pattern: {
              value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
              message: t("auth.validation.emailInvalid"),
            },
          })}
          placeholder={t("auth.fields.emailPlaceholder")}
          className="h-10 border-input focus:border-primary focus:ring-primary"
          disabled={isLoading}
        />
      </div>
      {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}

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
            placeholder={t("auth.login.passwordPlaceholder")}
            className="h-10 pr-10 border-input focus:border-primary focus:ring-primary"
            disabled={isLoading}
          />
          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={showPassword ? t("auth.fields.hidePassword") : t("auth.fields.showPassword")}>
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}

      <Button type="submit" disabled={isSubmitting || isLoading} size="lg" className="w-full">
        {isLoading ? <Spinner className="h-4 w-4" /> : t("auth.login.submit")}
      </Button>
      {loginError && <p className="text-sm text-destructive">{loginError}</p>}
    </form>
  );
}
