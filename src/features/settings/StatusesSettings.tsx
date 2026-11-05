import { useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus, Shield, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { EntityStatusBadge } from "../../ui/StatusBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/Tabs";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { controlClassName } from "../../ui/controlStyles";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/Dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { ORDER_STATUSES } from "../industries/industryWorkflow";
import { useCreateStatusDefinition } from "../statuses/useCreateStatusDefinition";
import { useGetStatusDefinitions } from "../statuses/useGetStatusDefinitions";
import { useGetStatusTransitions } from "../statuses/useGetStatusTransitions";
import {
  useDeleteStatusDefinition,
  useReorderStatusDefinitions,
  useReplaceOrderStatus,
  useSetDefaultStatusDefinition,
  useSetOrderLifecycleSemantic,
  useUpdateStatusDefinition,
} from "../statuses/useStatusDefinitionMutations";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { withSubscriptionWriteAccess } from "../workspaces/workspaceSubscription";
import { canManageWorkspace } from "../workspaces/workspaceRoles";
import { PERMISSION_KEYS } from "../roles/permissions";
import { useMyPermissions } from "../roles/useMyPermissions";
import {
  STATUS_GROUPS,
  isLifecycleOrderStatusDefinition,
  type StatusDefinition,
  type StatusEntity,
  type StatusGroup,
  type StatusSemanticAction,
} from "../../services/apiStatusDefinitions";

const entities: StatusEntity[] = ["order", "estimate", "lead", "invoice", "transfer", "task"];

function semanticLabelKey(action: StatusSemanticAction) {
  if (action === "close") return "settings.statuses.semantic.close";
  if (action === "cancel") return "settings.statuses.semantic.cancel";
  return "settings.statuses.semantic.normal";
}

export function StatusesSettings() {
  const { t } = useTranslation();
  const [entity, setEntity] = useState<StatusEntity>("order");
  const { data = [], isLoading, error } = useGetStatusDefinitions();
  const { data: transitions } = useGetStatusTransitions();
  const workspaceRole = useActiveWorkspaceRole();
  const { canWrite: subscriptionAllowsWrite } = useWorkspaceSubscription();
  const { can } = useMyPermissions();
  const canEdit = withSubscriptionWriteAccess(
    can(PERMISSION_KEYS.settingsStatuses, canManageWorkspace(workspaceRole)),
    subscriptionAllowsWrite,
  );
  const createStatus = useCreateStatusDefinition();
  const updateStatus = useUpdateStatusDefinition();
  const setDefault = useSetDefaultStatusDefinition();
  const reorder = useReorderStatusDefinitions();
  const deleteStatus = useDeleteStatusDefinition();
  const setSemantic = useSetOrderLifecycleSemantic();
  const replaceStatus = useReplaceOrderStatus();

  const [form, setForm] = useState({
    name: "",
    color: "#2563eb",
    statusGroup: "new" as StatusGroup,
    systemStatus: "",
    sortOrder: "0",
  });
  const [editing, setEditing] = useState<StatusDefinition | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#2563eb");
  const [replaceFrom, setReplaceFrom] = useState<StatusDefinition | null>(null);
  const [replaceToId, setReplaceToId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<StatusDefinition | null>(null);

  const statusNames = useMemo(() => new Map(data.map((status) => [status.id, status.name])), [data]);
  const byEntity = useMemo(() => {
    const map = new Map<StatusEntity, StatusDefinition[]>();
    for (const status of data) {
      const list = map.get(status.entity) ?? [];
      list.push(status);
      map.set(status.entity, list);
    }
    return map;
  }, [data]);

  const orderStatuses = byEntity.get("order") ?? [];
  const configurableOrderStatuses = orderStatuses.filter((status) => !isLifecycleOrderStatusDefinition(status));
  const lifecycleOrderStatuses = orderStatuses.filter((status) => isLifecycleOrderStatusDefinition(status));

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

  function moveStatus(list: StatusDefinition[], index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= list.length) return;
    const ordered = [...list];
    const [item] = ordered.splice(index, 1);
    ordered.splice(next, 0, item);
    reorder.mutate(ordered.map((status) => status.id));
  }

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
            {entities.map((item) => {
              const entityStatuses = byEntity.get(item) ?? [];
              const listStatuses =
                item === "order" ? configurableOrderStatuses : entityStatuses;
              return (
              <TabsContent key={item} value={item} className="mt-4 space-y-4">
                {entityStatuses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("settings.statuses.emptyEntity")}</p>
                ) : null}
                {entityStatuses.length > 0 && listStatuses.length === 0 && item === "order" ? (
                  <p className="text-sm text-muted-foreground">{t("settings.statuses.emptyConfigurable")}</p>
                ) : null}
                {listStatuses.length > 0 ? (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {listStatuses.map((status, index, list) => (
                      <li key={status.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <EntityStatusBadge name={status.name} color={status.color} />
                            {status.isDefault ? (
                              <span className="text-xs text-muted-foreground">{t("settings.statuses.default")}</span>
                            ) : null}
                            {!status.isActive ? (
                              <span className="text-xs text-muted-foreground">{t("settings.statuses.inactive")}</span>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t(`settings.statuses.groups.${status.statusGroup}`, {
                              defaultValue: status.statusGroup,
                            })}
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
                        {canEdit && item === "order" ? (
                          <div className="flex flex-wrap gap-1">
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              disabled={index === 0 || reorder.isPending}
                              onClick={() => moveStatus(list, index, -1)}
                              aria-label={t("settings.statuses.moveUp")}
                            >
                              <ArrowUp className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              disabled={index === list.length - 1 || reorder.isPending}
                              onClick={() => moveStatus(list, index, 1)}
                              aria-label={t("settings.statuses.moveDown")}
                            >
                              <ArrowDown className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditing(status);
                                setEditName(status.name);
                                setEditColor(status.color || "#2563eb");
                              }}
                            >
                              {t("common.edit")}
                            </Button>
                            {!status.isDefault && status.isActive ? (
                              <Button type="button" size="sm" variant="outline" onClick={() => setDefault.mutate(status.id)}>
                                {t("settings.statuses.setDefault")}
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => updateStatus.mutate({ id: status.id, isActive: !status.isActive })}
                            >
                              {status.isActive ? t("settings.statuses.deactivate") : t("settings.statuses.activate")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setSemantic.mutate({ statusId: status.id, action: "close" })}
                            >
                              {t("settings.statuses.assignClose")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setSemantic.mutate({ statusId: status.id, action: "cancel" })}
                            >
                              {t("settings.statuses.assignCancel")}
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => setReplaceFrom(status)}>
                              {t("settings.statuses.replace")}
                            </Button>
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => setDeleteTarget(status)}
                              aria-label={t("settings.statuses.delete")}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item === "order" && lifecycleOrderStatuses.length > 0 ? (
                  <div className="space-y-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">{t("settings.statuses.lifecycleTitle")}</p>
                      <p className="text-xs text-muted-foreground">{t("settings.statuses.lifecycleDescription")}</p>
                    </div>
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {lifecycleOrderStatuses.map((status) => (
                        <li key={status.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <EntityStatusBadge name={status.name} color={status.color} />
                              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                                <Shield className="size-3" />
                                {t(semanticLabelKey(status.semanticAction === "normal" ? (status.systemStatus === "cancelled" ? "cancel" : "close") : status.semanticAction))}
                              </span>
                              {!status.isActive ? (
                                <span className="text-xs text-muted-foreground">{t("settings.statuses.inactive")}</span>
                              ) : null}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {t(`settings.statuses.groups.${status.statusGroup}`, {
                                defaultValue: status.statusGroup,
                              })}
                            </p>
                          </div>
                          <p className="text-xs text-muted-foreground">{t("settings.statuses.lifecycleReadOnly")}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </TabsContent>
              );
            })}
          </Tabs>
        ) : null}

        {canEdit ? (
          <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
            <p className="text-sm font-medium text-foreground sm:col-span-2">{t("settings.statuses.form.title")}</p>
            <p className="text-xs text-muted-foreground sm:col-span-2">{t("settings.statuses.form.normalOnlyHint")}</p>
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
                {ORDER_STATUSES.filter((status) => status !== "closed" && status !== "cancelled").map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{t("settings.statuses.form.systemStatusHint")}</p>
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

        <Dialog open={editing != null} onOpenChange={(open) => !open && setEditing(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("settings.statuses.editTitle")}</DialogTitle>
              <DialogDescription>{t("settings.statuses.editDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-status-name">{t("settings.statuses.form.name")}</Label>
                <Input id="edit-status-name" value={editName} onChange={(event) => setEditName(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-status-color">{t("settings.statuses.form.color")}</Label>
                <Input
                  id="edit-status-color"
                  type="color"
                  className="w-20 p-1"
                  value={editColor}
                  onChange={(event) => setEditColor(event.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                disabled={!editName.trim() || updateStatus.isPending}
                onClick={() => {
                  if (!editing) return;
                  updateStatus.mutate(
                    { id: editing.id, name: editName, color: editColor },
                    { onSuccess: () => setEditing(null) },
                  );
                }}
              >
                {t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={replaceFrom != null} onOpenChange={(open) => !open && setReplaceFrom(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("settings.statuses.replaceTitle")}</DialogTitle>
              <DialogDescription>
                {t("settings.statuses.replaceDescription", { name: replaceFrom?.name ?? "" })}
              </DialogDescription>
            </DialogHeader>
            <Select value={replaceToId} onValueChange={setReplaceToId}>
              <SelectTrigger>
                <SelectValue placeholder={t("settings.statuses.replacePick")} />
              </SelectTrigger>
              <SelectContent>
                {configurableOrderStatuses
                  .filter((status) => status.id !== replaceFrom?.id && status.isActive)
                  .map((status) => (
                    <SelectItem key={status.id} value={status.id}>
                      {status.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReplaceFrom(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                disabled={!replaceFrom || !replaceToId || replaceStatus.isPending}
                onClick={() => {
                  if (!replaceFrom || !replaceToId) return;
                  replaceStatus.mutate(
                    { fromStatusId: replaceFrom.id, toStatusId: replaceToId },
                    {
                      onSuccess: () => {
                        setReplaceFrom(null);
                        setReplaceToId("");
                      },
                    },
                  );
                }}
              >
                {t("settings.statuses.replaceConfirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("settings.statuses.deleteTitle")}</DialogTitle>
              <DialogDescription>
                {t("settings.statuses.deleteDescription", { name: deleteTarget?.name ?? "" })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!deleteTarget || deleteStatus.isPending}
                onClick={() => {
                  if (!deleteTarget) return;
                  deleteStatus.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
                }}
              >
                {t("settings.statuses.delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
