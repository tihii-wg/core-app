import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { changePassword } from "../../services/apiPassword";
import i18n from "../../i18n";

type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
};

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => changePassword(input),
    onSuccess() {
      toast.success(i18n.t("auth.password.changed"));
    },
    onError(error) {
      toast.error(error.message || i18n.t("auth.password.errors.changeFailed"));
    },
  });
}
