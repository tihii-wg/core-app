import { useQueryClient, useMutation } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { login as logInApi } from "../../services/apiAuth";
import { useNavigate } from "react-router-dom";
import { getProfile } from "../../services/apiProfiles";

type LogInData = {
  email: string;
  password: string;
};

export function useLogin() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function finishLogin(user: User) {
    queryClient.clear();
    queryClient.setQueryData(["user"], user);
    await queryClient.prefetchQuery({ queryKey: ["profiles"], queryFn: getProfile, retry: false });
    navigate("/en/dashboard", { replace: true });
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
