import { useState } from "react";
import { ArrowLeft, CheckCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/Button";
import { Label } from "../ui/Label";
import { Input } from "../ui/Input";
import { Spinner } from "../ui/Spinner";
import { LogoMark } from "../ui/Logo";
import { languageFromPath } from "../i18n/languages";
import { useLocation, useNavigate } from "react-router-dom";
import { requestPasswordReset } from "../services/apiAuth";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const language = languageFromPath(useLocation().pathname);
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError("");

    const trimmed = email.trim();
    if (!trimmed) {
      setError(t("auth.validation.emailRequired"));
      return;
    }
    if (!EMAIL_PATTERN.test(trimmed)) {
      setError(t("auth.validation.emailInvalid"));
      return;
    }

    setIsLoading(true);
    try {
      await requestPasswordReset(trimmed, language);
      setIsSubmitted(true);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : t("auth.forgotPassword.errors.sendFailed");
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  function onSwitchToLogin() {
    navigate(`/${language}/login`);
  }

  if (isSubmitted) {
    return (
      <div className="min-h-dvh bg-background flex flex-col">
        <div className="p-4">
          <button type="button" onClick={onSwitchToLogin} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            {t("auth.backToLogin")}
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center px-4 pb-16">
          <div className="w-full max-w-sm text-center">
            <div className="bg-card rounded-xl border border-border p-8 shadow-sm">
              <div className="inline-flex items-center justify-center h-12 w-12 bg-success/10 rounded-full mb-4">
                <CheckCircle className="h-6 w-6 text-success" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">{t("auth.forgotPassword.checkInbox")}</h2>
              <p className="text-sm text-muted-foreground mb-6 break-words">{t("auth.forgotPassword.successGeneric")}</p>
              <Button onClick={onSwitchToLogin} variant="outline" size="lg" className="w-full">
                {t("auth.backToLogin")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      <div className="p-4">
        <button type="button" onClick={onSwitchToLogin} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {t("auth.backToLogin")}
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 mb-2">
              <LogoMark className="size-10" />
              <span className="text-2xl font-semibold text-foreground">{t("common.appName")}</span>
            </div>
            <p className="text-sm text-muted-foreground">{t("auth.forgotPassword.tagline")}</p>
          </div>

          <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
            <p className="text-sm text-muted-foreground mb-4">{t("auth.forgotPassword.instructions")}</p>
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm text-foreground">
                  {t("auth.fields.email")}
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("auth.fields.emailPlaceholder")}
                  className="h-10"
                  disabled={isLoading}
                />
                {error && <p className="text-xs text-destructive break-words">{error}</p>}
              </div>

              <Button type="submit" disabled={isLoading} size="lg" className="w-full">
                {isLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner className="h-4 w-4" />
                    {t("auth.forgotPassword.submitting")}
                  </span>
                ) : (
                  t("auth.forgotPassword.submit")
                )}
              </Button>
            </form>
          </div>

          <div className="mt-4 text-center">
            <span className="text-sm text-muted-foreground">{t("auth.forgotPassword.rememberPassword")} </span>
            <button type="button" onClick={onSwitchToLogin} className="text-sm text-primary hover:underline font-medium">
              {t("auth.logIn")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
