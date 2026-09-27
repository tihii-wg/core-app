import { useQueryClient, useMutation } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { login as logInApi } from "../../services/apiAuth";
import { useNavigate } from "react-router-dom";

type LogInData = {
  email: string;
  password: string;
};

export function useLogin() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  function finishLogin(user: User) {
    queryClient.clear();
    queryClient.setQueryData(["user"], user);
    navigate("/en/dashboard", { replace: true });
  }

  const { mutateAsync: login, isPending: isLoading } = useMutation({
    mutationFn: ({ email, password }: LogInData) => logInApi({ email, password }),
    onSuccess: (result) => {
      if (result.mfaRequired) return;
      finishLogin(result.user);
    },
  });

  return { login, isLoading, finishLogin };
}
