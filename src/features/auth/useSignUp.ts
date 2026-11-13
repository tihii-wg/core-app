import { useMutation, useQueryClient } from "@tanstack/react-query";
import { signUp } from "../../services/apiAuth";
import { useLocation, useNavigate } from "react-router-dom";
import { languageFromPath } from "../../i18n/languages";

export function useSignUp() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const language = languageFromPath(useLocation().pathname);
  return useMutation({
    mutationFn: signUp,
    onSuccess: (result) => {
      if (result.needsEmailConfirmation) return;
      queryClient.setQueryData(["user"], result.user);
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      if (result.mode === "join") {
        navigate(`/${language}/dashboard`, { replace: true });
        return;
      }
      navigate(`/${language}/onboarding`, { replace: true });
    },
  });
}
