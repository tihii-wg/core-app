import { useQueryClient, useMutation } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { ensureSignupBootstrap, login as logInApi } from "../../services/apiAuth";
import { rememberSessionIdleActivity } from "./sessionIdleTimeout";
import { useLocation, useNavigate } from "react-router-dom";
import { getProfile } from "../../services/apiProfiles";
import { languageFromPath } from "../../i18n/languages";

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

    navigate(`/${language}/dashboard`, { replace: true });
  }

  const { mutateAsync: login, isPending: isLoading } = useMutation({
    mutationFn: ({ email, password }: LogInData) => logInApi({ email, password }),
    onSuccess: (result) => {
      if (result.mfaRequired) return;
      return finishLogin(result.user);
    },
  });

  return { login, isLoading, finishLogin };
}
