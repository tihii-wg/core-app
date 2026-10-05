import { useMutation } from "@tanstack/react-query";
import { signUp } from "../../services/apiAuth";
import { useLocation, useNavigate } from "react-router-dom";
import { languageFromPath } from "../../i18n/languages";

export function useSignUp() {
  const navigate = useNavigate();
  const language = languageFromPath(useLocation().pathname);
  return useMutation({
    mutationFn: signUp,
    onSuccess: () => {
      navigate(`/${language}/dashboard`, { replace: true });
    },
  });
}
