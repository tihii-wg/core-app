import { ALLOW_WHEN_READ_ONLY } from "../workspaces/readOnlyMode";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { ensureSignupBootstrap, login as logInApi } from "../../services/apiAuth";
import { rememberSessionIdleActivity } from "./sessionIdleTimeout";
import { useLocation, useNavigate } from "react-router-dom";
import { getProfile } from "../../services/apiProfiles";
import { languageFromPath } from "../../i18n/languages";
import { isNewVersionDeployed } from "../../lib/appVersion";

type LogInData = {
  email: string;
  password: string;
};

export function useLogin() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const language = languageFromPath(useLocation().pathname);

  async function finishLogin(user: User) {
    rememberSessionIdleActivity(user.id);
    queryClient.clear();
    queryClient.setQueryData(["user"], user);
    await queryClient.prefetchQuery({ queryKey: ["profiles"], queryFn: getProfile, retry: false });

    // Post email-confirmation: profile row may still be missing.
    if (queryClient.getQueryData(["profiles"]) == null) {
      try {
        await ensureSignupBootstrap(user);
        await queryClient.invalidateQueries({ queryKey: ["profiles"] });
        await queryClient.prefetchQuery({ queryKey: ["profiles"], queryFn: getProfile, retry: false });
      } catch {
        // Waiting screen / onboarding handle incomplete signup state.
      }
    }

    // Logging in does not reload the page: if a newer deployment is live, load it now (the session is
    // already stored, so the reloaded app opens signed in). Short timeout — never hold up the login.
    if (await isNewVersionDeployed(1500)) {
      window.location.assign(`/${language}/dashboard`);
      return;
    }
    navigate(`/${language}/dashboard`, { replace: true });
  }

  const { mutateAsync: login, isPending: isLoading } = useMutation({
    meta: ALLOW_WHEN_READ_ONLY,
    mutationFn: ({ email, password }: LogInData) => logInApi({ email, password }),
    onSuccess: (result) => {
      if (result.mfaRequired) return;
      return finishLogin(result.user);
    },
  });

  return { login, isLoading, finishLogin };
}
