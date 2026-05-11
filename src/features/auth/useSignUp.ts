import { useMutation } from "@tanstack/react-query";
import { signUp } from "../../services/apiAuth";

export function useSignUp() {
  return useMutation({
    mutationFn: signUp,
  });
}
