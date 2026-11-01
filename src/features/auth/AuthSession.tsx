import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import supabase from "../../services/supabase";
import { languageFromPath } from "../../i18n/languages";
import { clearPasswordRecoveryFlag, confirmPasswordRecovery } from "./passwordRecovery";
import { finishSignOut } from "./session";

function isResetPasswordPath(pathname: string) {
  return /\/reset-password\/?$/.test(pathname);
}

export function AuthSession() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        clearPasswordRecoveryFlag();
        // Defer navigation/cache work — avoid async Supabase work inside this callback.
        window.setTimeout(() => finishSignOut(queryClient, navigate), 0);
        return;
      }

      if (!session) return;

      if (event === "PASSWORD_RECOVERY") {
        confirmPasswordRecovery(session.user.id);
        queryClient.setQueryData(["user"], session.user);
        // If Supabase fell back to Site URL (root/login), move to the reset form after confirmation.
        window.setTimeout(() => {
          if (isResetPasswordPath(window.location.pathname)) return;
          const locale = languageFromPath(window.location.pathname);
          navigate(`/${locale}/reset-password`, { replace: true });
        }, 0);
        return;
      }

      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        queryClient.setQueryData(["user"], session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, queryClient]);

  return null;
}
