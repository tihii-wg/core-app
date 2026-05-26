import { useMutation } from "@tanstack/react-query";
import { signUp } from "../../services/apiAuth";
import { useNavigate } from "react-router-dom";

export function useSignUp() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: signUp,
    onSuccess: () => {
      const locale = "en";

      navigate(`/${locale}/dashboard`, { replace: true });
    },
  });
}
