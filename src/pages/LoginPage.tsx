import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

import LoginForm from "../features/auth/LoginForm";
import Logo from "../ui/Logo";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/Select";
import { isAppLanguage, languageFromPath, languageNames, supportedLanguages } from "../i18n/languages";
import { useLocation, useNavigate } from "react-router-dom";


export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const language = languageFromPath(useLocation().pathname);

  function onSwitchToRegister() {
    navigate(`/${language}/register`);
  }

  function onSwitchToForgotPassword() {
    navigate(`/${language}/forgot-password`);
  }

  function onChangeLanguage(value: string) {
    if (isAppLanguage(value) && value !== language) navigate(`/${value}/login`, { replace: true });
  }

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      {/* Language selector */}
      <div className="flex justify-end p-4">
        <Select value={language} onValueChange={onChangeLanguage}>
          <SelectTrigger size="sm" aria-label={t("auth.languageLabel")} className="gap-2 border-none bg-transparent px-0 text-sm text-muted-foreground shadow-none hover:text-foreground">
            <Globe className="h-4 w-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {supportedLanguages.map((code) => (
              <SelectItem key={code} value={code} lang={code}>
                {languageNames[code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Login form */}
      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="text-center mb-8">
            <Logo />
            <p className="text-sm text-muted-foreground">{t("auth.login.tagline")}</p>
          </div>

          {/* Form */}
          <div className="bg-card rounded-xl border border-border p-6 shadow-sm">

            
            <LoginForm />

            <div className="mt-4 text-center">
              <button type="button" onClick={onSwitchToForgotPassword} className="text-sm cursor-pointer text-primary hover:underline">
                {t("auth.login.forgotPassword")}
              </button>
            </div>
          </div>

          {/* Register link */}
          <div className="mt-4 text-center">
            <span className="text-sm text-muted-foreground">{t("auth.login.noAccount")} </span>
            <button type="button" onClick={onSwitchToRegister} className="text-sm text-primary hover:underline font-medium cursor-pointer">
              {t("auth.login.createAccount")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
