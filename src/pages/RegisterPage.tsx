import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

import RegisterForm from "../features/auth/RegisterForm";
import Logo from "../ui/Logo";
import { languageFromPath } from "../i18n/languages";
import { useLocation, useNavigate } from "react-router-dom";



export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const language = languageFromPath(useLocation().pathname);

  function onSwitchToLogin() {
    navigate(`/${language}/login`);
  }

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      {/* Back button */}
      <div className="p-4">
        <button onClick={onSwitchToLogin} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {t("auth.backToLogin")}
        </button>
      </div>

      {/* Register form */}
      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="text-center mb-8">
            <Logo />
            <p className="text-sm text-muted-foreground">{t("auth.register.tagline")}</p>
          </div>

          {/* Form */}
          <RegisterForm />

          {/* Login link */}
          <div className="mt-4 text-center">
            <span className="text-sm text-muted-foreground">{t("auth.register.haveAccount")} </span>
            <button type="button" onClick={onSwitchToLogin} className="text-sm text-primary hover:underline font-medium">
              {t("auth.logIn")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
