import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { logOut as logOutApi } from "../../services/apiAuth";
import { finishSignOut } from "./session";
import i18n from "../../i18n";

export function useLogOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { mutateAsync: logOut, isPending: isLoading } = useMutation({
    mutationFn: logOutApi,
    onSuccess: () => {
      finishSignOut(queryClient, navigate);
    },
    onError: (error) => {
      toast.error(i18n.t("auth.errors.logoutFailed"));
      if (import.meta.env.DEV) console.error(error);
    },
  });

  return { logOut, isLoading };
}
