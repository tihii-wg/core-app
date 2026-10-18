import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useGetIndustries } from "../industries/useGetIndustries";
import { industryName } from "../industries/industryName";
import { useGetProfile } from "../profiles/useGetProfile";
import { useGetWorkspaces } from "../workspaces/useGetWorkspaces";
import { useLogOut } from "../auth/useLogOut";
import Logo from "../../ui/Logo";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import FullPage from "../../ui/FullPage";
import { cn } from "../../lib/utils";
import { ownedWorkspaceNeedingSetup } from "./businessSetup";
import { industryIcon } from "./industryIcon";
import { useSetWorkspaceIndustry } from "./useSetWorkspaceIndustry";

export function BusinessSetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale = "en" } = useParams();
  const { data: profile, isLoading: profileLoading, error: profileError } = useGetProfile();
  const { workspaces, isLoading: workspacesLoading, error: workspacesError } = useGetWorkspaces();
  const { industries, isLoading: industriesLoading, isFetching: industriesFetching, error: industriesError, refetch } = useGetIndustries();
  const { mutateAsync, isPending: isSaving, error: saveError } = useSetWorkspaceIndustry();
  const { logOut, isLoading: isLoggingOut } = useLogOut();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const ready = !profileLoading && !workspacesLoading;
  const setupWorkspaceId = ready ? ownedWorkspaceNeedingSetup(workspaces, profile?.active_workspace_id ?? null, profile?.id ?? null) : null;
  const selected = industries.some((industry) => industry.id === selectedId);

  async function onContinue() {
    if (!setupWorkspaceId || !selectedId) return;
    try {
      const saved = await mutateAsync({ workspaceId: setupWorkspaceId, industryId: selectedId });
      if (!saved?.industryId) return;
      navigate(`/${locale}/${saved.id}/dashboard`, { replace: true });
    } catch {
      // The mutation error stays on screen so the selection can be saved again.
    }
  }

  if (!ready) {
    return (
      <FullPage>
        <Spinner />
      </FullPage>
    );
  }

  if (!profileError && !workspacesError && !setupWorkspaceId) {
    return <Navigate to={`/${locale}/dashboard`} replace />;
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-8 sm:px-6">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Logo />
          <Button type="button" variant="ghost" onClick={() => void logOut()} disabled={isLoggingOut}>
            {t("nav.userMenu.logOut")}
          </Button>
        </div>

        <div className="flex flex-1 flex-col justify-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{t("onboarding.title")}</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">{t("onboarding.description")}</p>

          {profileError || workspacesError ? <p className="mt-6 text-sm text-destructive">{(profileError ?? workspacesError)?.message}</p> : null}

          {setupWorkspaceId && industriesLoading ? (
            <div className="mt-8 flex items-center gap-3 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              {t("onboarding.loading")}
            </div>
          ) : null}

          {setupWorkspaceId && industriesError ? (
            <div className="mt-8 space-y-3">
              <p className="text-sm text-destructive">{industriesError.message || t("onboarding.loadFailed")}</p>
              <Button type="button" variant="outline" onClick={() => void refetch()} disabled={industriesFetching}>
                {industriesFetching ? <Spinner className="size-4" /> : null}
                {t("common.retry")}
              </Button>
            </div>
          ) : null}

          {setupWorkspaceId && !industriesLoading && !industriesError && industries.length === 0 ? <p className="mt-8 text-sm text-muted-foreground">{t("onboarding.empty")}</p> : null}

          {setupWorkspaceId && !industriesLoading && !industriesError && industries.length > 0 ? (
            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t("onboarding.title")}>
              {industries.map((industry) => {
                const Icon = industryIcon(industry.slug);
                const isSelected = industry.id === selectedId;
                return (
                  <button
                    key={industry.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelectedId(industry.id)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition-[border-color,box-shadow,background-color]",
                      isSelected ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/40",
                    )}
                  >
                    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                      <Icon className="size-5" />
                    </span>
                    <span className="font-medium text-foreground">{industryName(industry)}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {setupWorkspaceId ? (
            <div className="mt-8">
              {saveError ? <p className="mb-3 text-sm text-destructive">{saveError.message}</p> : null}
              <Button type="button" size="lg" className="w-full sm:w-auto" disabled={!selected || isSaving || industriesLoading || Boolean(industriesError)} onClick={() => void onContinue()}>
                {isSaving ? <Spinner className="size-4" /> : null}
                {t("common.continue")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
