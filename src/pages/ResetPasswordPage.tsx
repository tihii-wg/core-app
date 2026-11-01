import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle, Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../ui/Button";
import { Label } from "../ui/Label";
import { Input } from "../ui/Input";
import { Spinner } from "../ui/Spinner";
import { LogoMark } from "../ui/Logo";
import { languageFromPath } from "../i18n/languages";
import { endPasswordRecoverySession, updateRecoveredPassword } from "../services/apiAuth";
import { passwordChangeMessage, passwordMinimum, passwordRecoverySessionMessage } from "../services/authMessages";
import supabase from "../services/supabase";
import {
  clearPasswordRecoveryFlag,
  clearStalePasswordRecoveryMarker,
  confirmPasswordRecovery,
  isConfirmedRecoveryForUser,
  isExpiredRecoveryError,
  readAuthCallbackError,
  urlIndicatesPasswordRecovery,
} from "../features/auth/passwordRecovery";

type Gate = "checking" | "ready" | "invalid" | "expired" | "missing" | "success";

const RECOVERY_WAIT_MS = 2500;

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const language = languageFromPath(useLocation().pathname);

  const [gate, setGate] = useState<Gate>("checking");
  const [gateMessage, setGateMessage] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let settled = false;

    function finish(next: Gate, message = "") {
      if (cancelled || settled) return;
      settled = true;
      if (next === "invalid" || next === "expired" || next === "missing") {
        clearPasswordRecoveryFlag();
      }
      setGate(next);
      setGateMessage(message);
    }

    const callbackError = readAuthCallbackError();
    if (callbackError) {
      finish(isExpiredRecoveryError(callbackError) ? "expired" : "invalid", passwordRecoverySessionMessage(callbackError));
      return;
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session?.user?.id) {
        confirmPasswordRecovery(session.user.id);
        finish("ready");
      }
    });

    void (async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (cancelled) return;

        if (sessionError) {
          finish("invalid", passwordRecoverySessionMessage(sessionError.message));
          return;
        }

        const userId = session?.user?.id ?? null;
        clearStalePasswordRecoveryMarker(userId);

        // Refresh of an already confirmed recovery for this same user.
        if (session && isConfirmedRecoveryForUser(userId)) {
          finish("ready");
          return;
        }

        // URL may look like a callback, but only PASSWORD_RECOVERY confirms recovery.
        // Wait briefly for Supabase to finish exchanging the link.
        const possibleCallback = urlIndicatesPasswordRecovery();
        if (possibleCallback || !session) {
          await new Promise((resolve) => window.setTimeout(resolve, RECOVERY_WAIT_MS));
          if (cancelled || settled) return;

          const {
            data: { session: laterSession },
          } = await supabase.auth.getSession();
          const laterUserId = laterSession?.user?.id ?? null;
          clearStalePasswordRecoveryMarker(laterUserId);

          if (laterSession && isConfirmedRecoveryForUser(laterUserId)) {
            finish("ready");
            return;
          }

          if (possibleCallback && !laterSession) {
            finish("expired", t("auth.resetPassword.errors.linkExpired"));
            return;
          }

          finish("missing", t("auth.resetPassword.errors.noSession"));
          return;
        }

        // Authenticated session without a confirmed recovery marker (and no recovery URL) → not a recovery flow.
        finish("missing", t("auth.resetPassword.errors.noSession"));
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        finish(isExpiredRecoveryError(message) ? "expired" : "invalid", passwordRecoverySessionMessage(message || "invalid"));
      }
    })();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [t]);

  function leaveRecoveryToLogin() {
    clearPasswordRecoveryFlag();
    navigate(`/${language}/login`);
  }

  function goForgot() {
    clearPasswordRecoveryFlag();
    navigate(`/${language}/forgot-password`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLoading) return;
    setError("");

    if (!password) {
      setError(t("auth.validation.passwordRequired"));
      return;
    }
    if (password.length < passwordMinimum) {
      setError(t("auth.validation.passwordMinLength", { count: passwordMinimum }));
      return;
    }
    if (!confirmPassword) {
      setError(t("auth.resetPassword.confirmRequired"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.resetPassword.passwordsMismatch"));
      return;
    }

    setIsLoading(true);
    try {
      await updateRecoveredPassword(password);
      try {
        await endPasswordRecoverySession();
      } catch {
        // Password already updated; sign-out failure must not hide success.
        clearPasswordRecoveryFlag();
      }
      setGate("success");
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      setError(raw || passwordChangeMessage("change failed"));
    } finally {
      setIsLoading(false);
    }
  }

  if (gate === "checking") {
    return (
      <div className="min-h-dvh bg-background flex flex-col items-center justify-center px-4">
        <Spinner className="h-8 w-8 text-primary" />
        <p className="mt-4 text-sm text-muted-foreground">{t("auth.resetPassword.checking")}</p>
      </div>
    );
  }

  if (gate === "success") {
    return (
      <div className="min-h-dvh bg-background flex flex-col">
        <div className="p-4">
          <button type="button" onClick={leaveRecoveryToLogin} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
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
              <h2 className="text-lg font-semibold text-foreground mb-2">{t("auth.resetPassword.successTitle")}</h2>
              <p className="text-sm text-muted-foreground mb-6 break-words">{t("auth.resetPassword.successBody")}</p>
              <Button onClick={leaveRecoveryToLogin} size="lg" className="w-full">
                {t("auth.backToLogin")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (gate === "invalid" || gate === "expired" || gate === "missing") {
    const title =
      gate === "expired" ? t("auth.resetPassword.expiredTitle") : gate === "missing" ? t("auth.resetPassword.missingTitle") : t("auth.resetPassword.invalidTitle");
    const body =
      gateMessage ||
      (gate === "expired" ? t("auth.resetPassword.errors.linkExpired") : gate === "missing" ? t("auth.resetPassword.errors.noSession") : t("auth.resetPassword.errors.linkInvalid"));

    return (
      <div className="min-h-dvh bg-background flex flex-col">
        <div className="p-4">
          <button type="button" onClick={leaveRecoveryToLogin} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
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
            </div>
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-4">
              <h2 className="text-lg font-semibold text-foreground">{title}</h2>
              <p className="text-sm text-muted-foreground break-words">{body}</p>
              <Button type="button" size="lg" className="w-full" onClick={goForgot}>
                {t("auth.resetPassword.requestAnother")}
              </Button>
              <Button type="button" variant="outline" size="lg" className="w-full" onClick={leaveRecoveryToLogin}>
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
        <button type="button" onClick={leaveRecoveryToLogin} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
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
            <p className="text-sm text-muted-foreground">{t("auth.resetPassword.tagline")}</p>
          </div>

          <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
            <p className="text-sm text-muted-foreground mb-4">{t("auth.resetPassword.instructions")}</p>
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="new-password" className="text-sm text-foreground">
                  {t("auth.resetPassword.newPassword")}
                </Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("auth.resetPassword.newPasswordPlaceholder")}
                    className="h-10 pr-10"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? t("auth.fields.hidePassword") : t("auth.fields.showPassword")}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password" className="text-sm text-foreground">
                  {t("auth.resetPassword.confirmPassword")}
                </Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirm ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t("auth.resetPassword.confirmPasswordPlaceholder")}
                    className="h-10 pr-10"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showConfirm ? t("auth.fields.hidePassword") : t("auth.fields.showPassword")}
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && <p className="text-xs text-destructive break-words">{error}</p>}

              <Button type="submit" disabled={isLoading} size="lg" className="w-full">
                {isLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner className="h-4 w-4" />
                    {t("auth.resetPassword.submitting")}
                  </span>
                ) : (
                  t("auth.resetPassword.submit")
                )}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
