import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import supabase from "../../services/supabase";
import { finishSignOut } from "./session";

export function AuthSession() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        window.setTimeout(() => finishSignOut(queryClient, navigate), 0);
        return;
      }

      if (!session) return;

      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        queryClient.setQueryData(["user"], session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, queryClient]);

  return null;
}
