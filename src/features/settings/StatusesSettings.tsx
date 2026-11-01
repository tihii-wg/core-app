import { useMemo, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { EntityStatusBadge } from "../../ui/StatusBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/Tabs";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { controlClassName } from "../../ui/controlStyles";
import { ORDER_STATUSES } from "../industries/industryWorkflow";
import { useCreateStatusDefinition } from "../statuses/useCreateStatusDefinition";
import { useGetStatusDefinitions } from "../statuses/useGetStatusDefinitions";
import { useGetStatusTransitions } from "../statuses/useGetStatusTransitions";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { withSubscriptionWriteAccess } from "../workspaces/workspaceSubscription";
import { canManageWorkspace } from "../workspaces/workspaceRoles";
import { PERMISSION_KEYS } from "../roles/permissions";
import { useMyPermissions } from "../roles/useMyPermissions";
import { STATUS_GROUPS, type StatusEntity, type StatusGroup } from "../../services/apiStatusDefinitions";

const entities: StatusEntity[] = ["order", "estimate", "lead", "invoice", "transfer", "task"];

export function StatusesSettings() {
  const { t } = useTranslation();
  const [entity, setEntity] = useState<StatusEntity>("order");
  const { data = [], isLoading, error } = useGetStatusDefinitions();
  const { data: transitions } = useGetStatusTransitions();
  const workspaceRole = useActiveWorkspaceRole();
  const { canWrite: subscriptionAllowsWrite } = useWorkspaceSubscription();
  const { can } = useMyPermissions();
  // Legacy (permissions unavailable): owner-only, as before. With permissions loaded: settings.statuses (owners hold '*').
  const canEdit = withSubscriptionWriteAccess(can(PERMISSION_KEYS.settingsStatuses, canManageWorkspace(workspaceRole)), subscriptionAllowsWrite);
  const createStatus = useCreateStatusDefinition();
  const [form, setForm] = useState<{
    name: string;
    color: string;
    statusGroup: StatusGroup;
    systemStatus: string;
    sortOrder: string;
  }>({ name: "", color: "#2563eb", statusGroup: "new", systemStatus: "", sortOrder: "0" });
  const statusNames = useMemo(() => new Map(data.map((status) => [status.id, status.name])), [data]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    createStatus.mutate(
      {
        entity: "order",
        name: form.name,
        color: form.color,
        statusGroup: form.statusGroup,
        systemStatus: form.systemStatus || null,
        sortOrder: Number(form.sortOrder) || 0,
      },
      { onSuccess: () => setForm((prev) => ({ ...prev, name: "", systemStatus: "" })) },
    );
  };

  const byEntity = useMemo(() => {
    const map = new Map<StatusEntity, typeof data>();
    for (const status of data) {
      const list = map.get(status.entity) ?? [];
      list.push(status);
      map.set(status.entity, list);
    }
    return map;
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.statuses.title")}</CardTitle>
        <CardDescription>{t("settings.statuses.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <p className="text-sm text-muted-foreground">{t("settings.statuses.loading")}</p> : null}
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        {!isLoading && !error && data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.statuses.empty")}</p>
        ) : null}

        {data.length > 0 ? (
          <Tabs value={entity} onValueChange={(value) => setEntity(value as StatusEntity)}>
            <TabsList className="flex h-auto flex-wrap gap-1">
              {entities.map((item) => (
                <TabsTrigger key={item} value={item}>
                  {t(`settings.statuses.entities.${item}`)}
                  <span className="ml-1 text-muted-foreground">({byEntity.get(item)?.length ?? 0})</span>
                </TabsTrigger>
              ))}
            </TabsList>
            {entities.map((item) => (
              <TabsContent key={item} value={item} className="mt-4 space-y-2">
                {(byEntity.get(item) ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("settings.statuses.emptyEntity")}</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {(byEntity.get(item) ?? []).map((status) => (
                      <li key={status.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <EntityStatusBadge name={status.name} color={status.color} />
                            {status.isDefault ? (
                              <span className="text-xs text-muted-foreground">{t("settings.statuses.default")}</span>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t("settings.statuses.group")}: {status.statusGroup}
                            {status.systemStatus ? ` · ${status.systemStatus}` : ""}
                            {status.color ? ` · ${status.color}` : ""}
                          </p>
                          {transitions && transitions.get(status.id)?.size ? (
                            <p className="text-xs text-muted-foreground">
                              {t("settings.statuses.nextStatuses")}:{" "}
                              {[...(transitions.get(status.id) ?? [])]
                                .map((id) => statusNames.get(id))
                                .filter(Boolean)
                                .join(", ")}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex gap-4">
                          <div className="rounded-md border border-border bg-background p-2">
                            <p className="mb-1 text-[11px] text-muted-foreground">{t("settings.statuses.previewLight")}</p>
                            <div className="rounded-md bg-[#f6f7f9] p-2">
                              <EntityStatusBadge name={status.name} color={status.color} />
                            </div>
                          </div>
                          <div className="rounded-md border border-border bg-background p-2">
                            <p className="mb-1 text-[11px] text-muted-foreground">{t("settings.statuses.previewDark")}</p>
                            <div className="dark rounded-md bg-[#0e1014] p-2">
                              <EntityStatusBadge name={status.name} color={status.color} />
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            ))}
          </Tabs>
        ) : null}

        {canEdit ? (
          <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
            <p className="text-sm font-medium text-foreground sm:col-span-2">{t("settings.statuses.form.title")}</p>
            <div className="space-y-1.5">
              <Label htmlFor="status-name">{t("settings.statuses.form.name")}</Label>
              <Input
                id="status-name"
                value={form.name}
                required
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status-color">{t("settings.statuses.form.color")}</Label>
              <Input
                id="status-color"
                type="color"
                className="w-20 p-1"
                value={form.color}
                onChange={(event) => setForm({ ...form, color: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status-group">{t("settings.statuses.group")}</Label>
              <select
                id="status-group"
                className={`${controlClassName} h-9 px-3 text-sm`}
                value={form.statusGroup}
                onChange={(event) => setForm({ ...form, statusGroup: event.target.value as StatusGroup })}
              >
                {STATUS_GROUPS.map((group) => (
                  <option key={group} value={group}>
                    {t(`settings.statuses.groups.${group}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status-system">{t("settings.statuses.form.systemStatus")}</Label>
              <select
                id="status-system"
                className={`${controlClassName} h-9 px-3 text-sm`}
                value={form.systemStatus}
                onChange={(event) => setForm({ ...form, systemStatus: event.target.value })}
              >
                <option value="">{t("settings.statuses.form.systemStatusNone")}</option>
                {ORDER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status-sort">{t("settings.statuses.form.sortOrder")}</Label>
              <Input
                id="status-sort"
                type="number"
                value={form.sortOrder}
                onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={createStatus.isPending || !form.name.trim()}>
                <Plus />
                {createStatus.isPending ? t("common.saving") : t("settings.statuses.form.submit")}
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
