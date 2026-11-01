import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { dryRunNotify, type DryRunNotifyInput } from "../../services/apiMessageDispatch";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

/** Writes a dry-run row to `message_log`. Never sends a real message. */
export function useDryRunNotify() {
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: (input: Omit<DryRunNotifyInput, "workspaceId">) => dryRunNotify({ ...input, workspaceId }),
    onSuccess: (result) => {
      if (result.reason === "dry_run") toast.success(i18n.t("settings.notificationRules.dryRun.logged"));
      else if (result.reason === "forbidden") toast.error(i18n.t("settings.notificationRules.dryRun.forbidden"));
      else toast.error(i18n.t("settings.notificationRules.dryRun.unavailable"));
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : i18n.t("settings.notificationRules.dryRun.failed"));
    },
  });
}
