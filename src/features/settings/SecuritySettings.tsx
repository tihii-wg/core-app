import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { TwoFactorSettings } from "./TwoFactorSettings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { useUpdateWorkspaceSessionIdleTimeout } from "../workspaces/useUpdateWorkspace";
import {
  isSessionIdleTimeoutColumnSupported,
  readSessionIdleDevOverrideMinutes,
  type WorkspaceDetails,
} from "../../services/apiWorkspaces";
import { sessionIdleTimeoutSelectValues } from "../auth/sessionIdleTimeout";

function canEditIdleTimeout(role: string | null | undefined, subscriptionCanWrite: boolean) {
  return (role === "owner" || role === "admin") && subscriptionCanWrite;
}

function SessionIdleTimeoutCard({ workspace }: { workspace: WorkspaceDetails }) {
  const { t } = useTranslation();
  const { canWrite } = useWorkspaceSubscription();
  const canEdit = canEditIdleTimeout(workspace.role, canWrite);

  function idleTimeoutLabel(minutes: number | null) {
    if (minutes == null) return t("settings.security.idleTimeout.options.off");
    if (minutes < 60) return t("settings.security.idleTimeout.options.minutes", { count: minutes });
    return t("settings.security.idleTimeout.options.hours", { count: minutes / 60 });
  }
  const schemaReady = isSessionIdleTimeoutColumnSupported();
  const { mutateAsync: save, isPending } = useUpdateWorkspaceSessionIdleTimeout();

  const persisted = workspace.sessionIdleTimeoutMinutes;
  const devOverride = readSessionIdleDevOverrideMinutes();
  const initial =
    import.meta.env.DEV && devOverride === 1 ? "1" : persisted == null ? "off" : String(persisted);

  const [value, setValue] = useState<string>(initial);

  useEffect(() => {
    const next =
      import.meta.env.DEV && readSessionIdleDevOverrideMinutes() === 1
        ? "1"
        : workspace.sessionIdleTimeoutMinutes == null
          ? "off"
          : String(workspace.sessionIdleTimeoutMinutes);
    setValue(next);
  }, [workspace.id, workspace.sessionIdleTimeoutMinutes]);

  async function onChange(next: string) {
    if (!canEdit || isPending) return;
    const minutes = next === "off" ? null : Number(next);
    setValue(next);
    toast.loading(t("settings.security.idleTimeout.toast.saving"), { id: "idle-timeout" });
    try {
      await save({ workspaceId: workspace.id, minutes });
      toast.success(t("settings.security.idleTimeout.toast.saved"), { id: "idle-timeout" });
    } catch (error) {
      setValue(
        workspace.sessionIdleTimeoutMinutes == null ? "off" : String(workspace.sessionIdleTimeoutMinutes),
      );
      toast.error(
        error instanceof Error ? error.message : t("settings.security.idleTimeout.toast.failed"),
        { id: "idle-timeout" },
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("settings.security.idleTimeout.title")}
        </CardTitle>
        <CardDescription>{t("settings.security.idleTimeout.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!schemaReady ? (
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-5">
            <p className="text-sm font-medium text-foreground">
              {t("settings.security.idleTimeout.schemaRequiredTitle")}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t("settings.security.idleTimeout.schemaRequiredDescription")}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="session-idle-timeout">{t("settings.security.idleTimeout.label")}</Label>
              <Select
                value={value}
                onValueChange={(v) => void onChange(v)}
                disabled={!canEdit || isPending}
              >
                <SelectTrigger id="session-idle-timeout" className="w-full md:max-w-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sessionIdleTimeoutSelectValues().map((minutes) => {
                    const key = minutes == null ? "off" : String(minutes);
                    return (
                      <SelectItem key={key} value={key}>
                        {idleTimeoutLabel(minutes)}
                        {minutes === 720 ? ` — ${t("settings.security.idleTimeout.recommended")}` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("settings.security.idleTimeout.hint")}</p>
              {import.meta.env.DEV && value === "1" ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {t("settings.security.idleTimeout.devMinuteNote")}
                </p>
              ) : null}
            </div>
            {!canEdit ? (
              <p className="text-xs text-muted-foreground">{t("settings.security.idleTimeout.memberNote")}</p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function SecuritySettings() {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);

  return (
    <div className="space-y-6">
      <ChangePasswordForm />
      <TwoFactorSettings />
      {workspace ? <SessionIdleTimeoutCard workspace={workspace} /> : null}
    </div>
  );
}
