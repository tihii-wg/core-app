import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { BrandLogoMark } from "@/components/BrandLogo";
import { PreferenceControls } from "@/components/PreferenceControls";
import { Button, Card, Input } from "@/components/ui";
import { useT } from "@/i18n/I18nProvider";

export function LoginPage() {
  const t = useT();
  const { configured, loading, session, demoMode, enterDemoMode, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && (session || demoMode)) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.signInFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <PreferenceControls />
      </div>
      <Card className="w-full max-w-md p-6">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-2 inline-flex items-center gap-2.5">
            <BrandLogoMark className="size-10" />
            <span className="text-2xl font-semibold tracking-tight text-[var(--fg)]">{t("app.brandName")}</span>
          </div>
          <p className="text-sm text-[var(--muted)]">{t("app.subtitle")}</p>
        </div>
        <p className="text-sm text-[var(--muted)]">{t("login.description")}</p>

        {!configured ? (
          <div className="mt-5 space-y-3 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-3 text-sm text-[var(--muted)]">
            <p>{t("login.notConfigured")}</p>
            <Button type="button" variant="secondary" className="w-full" onClick={enterDemoMode}>
              {t("login.continueDemo")}
            </Button>
          </div>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={(event) => void onSubmit(event)}>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-[var(--fg)]">{t("login.email")}</span>
            <Input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={!configured || submitting}
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-[var(--fg)]">{t("login.password")}</span>
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={!configured || submitting}
            />
          </label>
          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={!configured || submitting}>
            {submitting ? t("login.submitting") : t("login.submit")}
          </Button>
        </form>

        {configured ? (
          <Button type="button" variant="ghost" className="mt-3 w-full" onClick={enterDemoMode}>
            {t("login.continueDemo")}
          </Button>
        ) : null}
      </Card>
    </div>
  );
}
