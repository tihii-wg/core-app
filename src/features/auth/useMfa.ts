import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { disableTotp, enrollTotp, getMfaAssurance, getMfaStatus, verifyTotp } from "../../services/apiMfa";
import { sessionNeedsMfa } from "../../services/authMessages";
import i18n from "../../i18n";

export function useMfaStatus(enabled = true) {
  return useQuery({
    queryKey: ["mfa"],
    queryFn: getMfaStatus,
    enabled,
    retry: false,
  });
}

export function useSessionMfa(enabled: boolean) {
  const query = useQuery({
    queryKey: ["mfa-assurance"],
    queryFn: getMfaAssurance,
    enabled,
    retry: false,
  });

  return {
    needsMfa: sessionNeedsMfa(query.data ?? null),
    isLoading: enabled && query.isLoading,
    factorReady: query.isSuccess,
  };
}

function useRefreshMfa() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["mfa"] });
    void queryClient.invalidateQueries({ queryKey: ["mfa-assurance"] });
  };
}

export function useEnrollMfa() {
  return useMutation({
    mutationFn: enrollTotp,
  });
}

export function useVerifyMfa() {
  const refresh = useRefreshMfa();

  return useMutation({
    mutationFn: ({ factorId, code }: { factorId: string; code: string }) => verifyTotp(factorId, code),
    onSuccess() {
      refresh();
      toast.success(i18n.t("auth.mfa.enabled"));
    },
  });
}

export function useDisableMfa() {
  const refresh = useRefreshMfa();

  return useMutation({
    mutationFn: (factorId: string) => disableTotp(factorId),
    onSuccess() {
      refresh();
      toast.success(i18n.t("auth.mfa.disabled"));
    },
    onError(error) {
      toast.error(error.message || i18n.t("auth.mfa.errors.disableFailed"));
    },
  });
}
