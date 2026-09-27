import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { changePassword } from "../../services/apiPassword";

type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
};

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => changePassword(input),
    onSuccess() {
      toast.success("Password changed successfully.");
    },
    onError(error) {
      toast.error(error.message || "Unable to change password. Please try again.");
    },
  });
}
