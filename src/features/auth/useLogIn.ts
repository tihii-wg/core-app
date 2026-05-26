import { useQueryClient, useMutation } from "@tanstack/react-query";
import { login as logInApi } from "../../services/apiAuth";
import { useNavigate } from "react-router-dom";

type LogInData = {
  email: string;
  password: string;
};

export function useLogin() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { mutateAsync: login, isPending: isLoading } = useMutation({
    mutationFn: ({ email, password }: LogInData) => logInApi({ email, password }),
    onSuccess: (user) => {
      const locale = "en";
      queryClient.setQueryData(["user"], user.user);
      navigate(`/${locale}/dashboard`, { replace: true });
    },
    onError: (error) => {
      console.log("ERROR", error);
    },
  });

  return { login, isLoading };
}
