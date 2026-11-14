import { Navigate, Outlet, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { Button, Card, Skeleton } from "@/components/ui";
import { PreferenceControls } from "@/components/PreferenceControls";
import { useT } from "@/i18n/I18nProvider";

export function RequireAuth() {
  const t = useT();
  const { loading, session, user, isPlatformOwner, ownerCheckLoading, ownerCheckErrorKey, signOut } = useAuth();
  const location = useLocation();

  if (loading || ownerCheckLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-16">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!isPlatformOwner) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
          <PreferenceControls />
        </div>
        <Card className="w-full max-w-md space-y-4 p-6 text-center">
          <ShieldAlert className="mx-auto size-10 text-[var(--danger)]" aria-hidden />
          <h1 className="text-lg font-semibold text-[var(--fg)]">{t("noAccess.title")}</h1>
          <p className="text-sm text-[var(--muted)]">
            {ownerCheckErrorKey ? t(ownerCheckErrorKey) : t("noAccess.body", { email: user?.email ?? "" })}
          </p>
          <Button type="button" variant="secondary" className="w-full" onClick={() => void signOut()}>
            {t("chrome.signOut")}
          </Button>
        </Card>
      </div>
    );
  }

  return <Outlet />;
}
