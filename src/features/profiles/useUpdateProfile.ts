import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { updateProfile, updateProfileTheme, type ProfileTheme, type UpdateProfileInput } from "../../services/apiProfiles";

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateProfileInput) => updateProfile(input),
    onMutate() {
      toast.loading("Saving profile...", { id: "update-profile" });
    },
    onSuccess(profile) {
      queryClient.setQueryData(["profiles"], profile);
      toast.success("Profile updated", { id: "update-profile" });
    },
    onError(error) {
      toast.error(error.message || "Could not update profile", { id: "update-profile" });
    },
  });
}

export function useUpdateProfileTheme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (theme: ProfileTheme) => updateProfileTheme(theme),
    onSuccess(profile) {
      queryClient.setQueryData(["profiles"], profile);
    },
  });
}
