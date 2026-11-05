import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Lock, Save, Shield } from "lucide-react";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Label } from "../../ui/Label";
import { Skeleton } from "../../ui/Skeleton";
import { Switch } from "../../ui/Switch";
import {
  CLOSED_ORDER_GRANTABLE_ROLES,
  emptyClosedOrderGrants,
  type ClosedOrderGrantableRole,
  type ClosedOrderPermissionGrants,
} from "../../services/apiClosedOrderPermissions";
import { workspaceRoleLabel } from "../workspaces/workspaceRoles";
import type { WorkspaceDetails } from "../../services/apiWorkspaces";
import { useIsWorkspaceOwnerId } from "../workspaces/useIsWorkspaceOwnerId";
import {
  useClosedOrderPermissionGrants,
  useSaveClosedOrderPermissionGrants,
  useSaveOwnerCanManageClosedOrders,
} from "../orders/useClosedOrderPermissions";

function toggleRole(
  list: ReadonlyArray<ClosedOrderGrantableRole>,
  role: ClosedOrderGrantableRole,
  enabled: boolean,
): ClosedOrderGrantableRole[] {
  if (enabled) return CLOSED_ORDER_GRANTABLE_ROLES.filter((r) => list.includes(r) || r === role);
  return list.filter((r) => r !== role);
}

function RoleGrantGroup({
  title,
  description,
  roles,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  roles: ReadonlyArray<ClosedOrderGrantableRole>;
  disabled: boolean;
  onChange: (role: ClosedOrderGrantableRole, enabled: boolean) => void;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-[13px] text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-col gap-3">
        {CLOSED_ORDER_GRANTABLE_ROLES.map((role) => {
          const id = `${title}-${role}`;
          const checked = roles.includes(role);
          return (
            <div key={role} className="flex items-center justify-between gap-3">
              <Label htmlFor={id} className="font-normal">
                {workspaceRoleLabel(role)}
              </Label>
              <Switch
                id={id}
                checked={checked}
                disabled={disabled}
                onCheckedChange={(value) => onChange(role, value)}
                aria-label={workspaceRoleLabel(role)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OwnerManageClosedOrdersToggle({ workspace }: { workspace: WorkspaceDetails }) {
  const { t } = useTranslation();
  const save = useSaveOwnerCanManageClosedOrders();
  const [enabled, setEnabled] = useState(workspace.ownerCanManageClosedOrders === true);

  useEffect(() => {
    setEnabled(workspace.ownerCanManageClosedOrders === true);
  }, [workspace.ownerCanManageClosedOrders, workspace.id]);

  async function onToggle(next: boolean) {
    const previous = enabled;
    setEnabled(next);
    toast.loading(t("settings.closedOrderPermissions.manageToast.saving"), { id: "owner-manage-closed" });
    try {
      await save.mutateAsync(next);
      toast.success(t("settings.closedOrderPermissions.manageToast.saved"), { id: "owner-manage-closed" });
    } catch (err) {
      setEnabled(previous);
      toast.error(
        err instanceof Error ? err.message : t("settings.closedOrderPermissions.manageToast.failed"),
        { id: "owner-manage-closed" },
      );
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-4" data-owner-manage-closed-orders>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{t("settings.closedOrderPermissions.manageTitle")}</p>
        <p className="text-[13px] text-muted-foreground">{t("settings.closedOrderPermissions.manageDescription")}</p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="owner-manage-closed-orders" className="font-normal">
          {t("settings.closedOrderPermissions.manageLabel")}
        </Label>
        <Switch
          id="owner-manage-closed-orders"
          checked={enabled}
          disabled={save.isPending}
          onCheckedChange={(value) => void onToggle(value)}
          aria-label={t("settings.closedOrderPermissions.manageLabel")}
        />
      </div>
    </div>
  );
}

function ClosedOrderPermissionsForm({ workspace }: { workspace: WorkspaceDetails }) {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useClosedOrderPermissionGrants(workspace.id);
  const save = useSaveClosedOrderPermissionGrants();
  const [draft, setDraft] = useState<ClosedOrderPermissionGrants>(emptyClosedOrderGrants());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!data) return;
    setDraft({
      cancelClosed: [...data.cancelClosed],
      deleteClosed: [...data.deleteClosed],
    });
    setHydrated(true);
  }, [data]);

  const dirty =
    hydrated &&
    (JSON.stringify([...draft.cancelClosed].sort()) !== JSON.stringify([...(data?.cancelClosed ?? [])].sort()) ||
      JSON.stringify([...draft.deleteClosed].sort()) !== JSON.stringify([...(data?.deleteClosed ?? [])].sort()));

  async function onSave() {
    toast.loading(t("settings.closedOrderPermissions.toast.saving"), { id: "closed-order-perms" });
    try {
      await save.mutateAsync(draft);
      toast.success(t("settings.closedOrderPermissions.toast.saved"), { id: "closed-order-perms" });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("settings.closedOrderPermissions.toast.failed"),
        { id: "closed-order-perms" },
      );
    }
  }

  if (isLoading && !hydrated) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.closedOrderPermissions.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.closedOrderPermissions.title")}</CardTitle>
          <CardDescription>{t("settings.closedOrderPermissions.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : t("settings.closedOrderPermissions.loadFailed")}
          </p>
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            {t("common.retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("settings.closedOrderPermissions.title")}
        </CardTitle>
        <CardDescription>{t("settings.closedOrderPermissions.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <OwnerManageClosedOrdersToggle workspace={workspace} />

        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{t("settings.closedOrderPermissions.ownerAlways")}</p>
        </div>

        <RoleGrantGroup
          title={t("settings.closedOrderPermissions.cancelTitle")}
          description={t("settings.closedOrderPermissions.cancelDescription")}
          roles={draft.cancelClosed}
          disabled={save.isPending}
          onChange={(role, enabled) =>
            setDraft((prev) => ({ ...prev, cancelClosed: toggleRole(prev.cancelClosed, role, enabled) }))
          }
        />

        <RoleGrantGroup
          title={t("settings.closedOrderPermissions.deleteTitle")}
          description={t("settings.closedOrderPermissions.deleteDescription")}
          roles={draft.deleteClosed}
          disabled={save.isPending}
          onChange={(role, enabled) =>
            setDraft((prev) => ({ ...prev, deleteClosed: toggleRole(prev.deleteClosed, role, enabled) }))
          }
        />

        <div className="flex justify-end">
          <Button type="button" onClick={() => void onSave()} disabled={save.isPending || !dirty}>
            <Save />
            {save.isPending ? t("common.saving") : t("settings.closedOrderPermissions.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Owner Menu section. Visible only to workspaces.owner_id — not admins/managers/members. */
export function ClosedOrderPermissionsSettings({ workspace }: { workspace: WorkspaceDetails }) {
  const isOwnerByOwnerId = useIsWorkspaceOwnerId();
  if (!isOwnerByOwnerId) return null;
  return <ClosedOrderPermissionsForm workspace={workspace} />;
}
