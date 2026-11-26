import { ALLOW_WHEN_READ_ONLY } from "../workspaces/readOnlyMode";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { updateProfile, updateProfileTheme, type ProfileTheme, type UpdateProfileInput } from "../../services/apiProfiles";

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: ALLOW_WHEN_READ_ONLY,
    mutationFn: (input: UpdateProfileInput) => updateProfile(input),
    onMutate() {
      toast.loading(i18n.t("settings.profile.toast.saving"), { id: "update-profile" });
    },
    onSuccess(profile) {
      queryClient.setQueryData(["profiles"], profile);
      toast.success(i18n.t("settings.profile.toast.updated"), { id: "update-profile" });
    },
    onError(error) {
      toast.error(error.message || i18n.t("settings.profile.toast.updateFailed"), { id: "update-profile" });
    },
  });
}

export function useUpdateProfileTheme() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: ALLOW_WHEN_READ_ONLY,
    mutationFn: (theme: ProfileTheme) => updateProfileTheme(theme),
    onSuccess(profile) {
      queryClient.setQueryData(["profiles"], profile);
    },
  });
}
