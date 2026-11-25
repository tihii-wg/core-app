import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, ClipboardList, FileText, LayoutGrid, RotateCcw, Trash2, User } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { useConfirm } from "../../ui/ConfirmProvider";
import { Skeleton } from "../../ui/Skeleton";
import { Spinner } from "../../ui/Spinner";
import {
  getTrash,
  purgeTrash,
  restoreTrashItem,
  TRASH_RETENTION_DAYS,
  trashDaysLeft,
  TrashUnavailableError,
  type TrashItem,
  type TrashKind,
  type TrashPurgeResult,
} from "../../services/apiTrash";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { canManageWorkspace } from "../workspaces/workspaceRoles";

const KIND_ORDER: TrashKind[] = ["client", "vehicle", "template", "task", "workspace"];

const KIND_ICON: Record<TrashKind, typeof User> = {
  client: User,
  vehicle: Car,
  template: FileText,
  task: ClipboardList,
  workspace: LayoutGrid,
};

/** Query keys that show the restored / purged records. */
const KIND_QUERY_KEYS: Record<TrashKind, string[]> = {
  client: ["clients"],
  vehicle: ["vehicles", "clients"],
  template: ["document-templates"],
  task: ["tasks"],
  workspace: ["workspaces"],
};

function trashQueryKey(workspaceId: string | undefined) {
  return ["trash", workspaceId] as const;
}

/** Settings → Корзина: soft-deleted records (90 days), restore / delete now / empty (owner only). */
export function TrashSettings() {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const role = useActiveWorkspaceRole();
  const isOwner = canManageWorkspace(role);
  const [busyId, setBusyId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: trashQueryKey(workspaceId),
    queryFn: () => getTrash(workspaceId!),
    enabled: Boolean(workspaceId) && isOwner,
    retry: (count, error) => !(error instanceof TrashUnavailableError) && count < 2,
  });
  const items = useMemo(() => query.data ?? [], [query.data]);

  const groups = useMemo(
    () =>
      KIND_ORDER.map((kind) => ({ kind, items: items.filter((item) => item.kind === kind) })).filter(
        (group) => group.items.length > 0,
      ),
    [items],
  );

  function refreshAfter(kinds: TrashKind[]) {
    void queryClient.invalidateQueries({ queryKey: trashQueryKey(workspaceId) });
    const keys = new Set(kinds.flatMap((kind) => KIND_QUERY_KEYS[kind]));
    for (const key of keys) void queryClient.invalidateQueries({ queryKey: [key] });
  }

  function purgeToast(result: TrashPurgeResult) {
    const parts = [t("settings.trash.toast.deleted", { count: result.deleted })];
    if (result.kept > 0) parts.push(t("settings.trash.toast.kept", { count: result.kept }));
    if (result.workspaces > 0) parts.push(t("settings.trash.toast.workspaces", { count: result.workspaces }));
    toast.success(parts.join(" · "), { id: "trash", duration: 6000 });
  }

  const restore = useMutation({
    mutationFn: (item: TrashItem) => restoreTrashItem(workspaceId!, item.kind, item.id),
    onMutate: (item) => setBusyId(item.id),
    onSuccess: (_data, item) => {
      toast.success(t("settings.trash.toast.restored", { title: item.title }), { id: "trash" });
      refreshAfter([item.kind]);
    },
    onError: (error: Error) => toast.error(error.message, { id: "trash" }),
    onSettled: () => setBusyId(null),
  });

  const purgeOne = useMutation({
    mutationFn: (item: TrashItem) => purgeTrash(workspaceId!, { kind: item.kind, id: item.id }),
    onMutate: (item) => setBusyId(item.id),
    onSuccess: (result, item) => {
      purgeToast(result);
      refreshAfter([item.kind]);
    },
    onError: (error: Error) => toast.error(error.message, { id: "trash" }),
    onSettled: () => setBusyId(null),
  });

  const purgeAll = useMutation({
    mutationFn: () => purgeTrash(workspaceId!, null),
    onSuccess: (result) => {
      purgeToast(result);
      refreshAfter(KIND_ORDER);
    },
    onError: (error: Error) => toast.error(error.message, { id: "trash" }),
  });

  const anyBusy = restore.isPending || purgeOne.isPending || purgeAll.isPending;

  async function confirmPurgeOne(item: TrashItem) {
    const ok = await confirm({
      title: t("settings.trash.confirmOne.title"),
      description:
        item.kind === "workspace"
          ? t("settings.trash.confirmOne.workspace", { title: item.title })
          : t("settings.trash.confirmOne.description", { title: item.title }),
      confirmLabel: t("settings.trash.deleteNow"),
      cancelLabel: t("common.cancel"),
      tone: "destructive",
      icon: "danger",
    });
    if (ok) purgeOne.mutate(item);
  }

  async function confirmPurgeAll() {
    const ok = await confirm({
      title: t("settings.trash.confirmAll.title"),
      description: t("settings.trash.confirmAll.description", { count: items.length }),
      confirmLabel: t("settings.trash.emptyTrash"),
      cancelLabel: t("common.cancel"),
      tone: "destructive",
      icon: "danger",
    });
    if (ok) purgeAll.mutate();
  }

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { day: "2-digit", month: "2-digit", year: "numeric" }),
    [i18n.language],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1.5">
          <CardTitle>{t("settings.trash.title")}</CardTitle>
          <CardDescription>{t("settings.trash.description", { days: TRASH_RETENTION_DAYS })}</CardDescription>
        </div>
        {isOwner ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={anyBusy || items.length === 0}
            onClick={() => void confirmPurgeAll()}
            data-testid="trash-empty"
          >
            {purgeAll.isPending ? <Spinner className="size-4" /> : <Trash2 />}
            {t("settings.trash.emptyTrash")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        {role == null ? (
          <Skeleton className="h-12 w-full" />
        ) : !isOwner ? (
          <p className="text-sm text-muted-foreground">{t("settings.trash.ownerOnly")}</p>
        ) : query.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : query.error ? (
          <p className="text-sm text-destructive">{(query.error as Error).message}</p>
        ) : groups.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-8 text-center">
            <Trash2 aria-hidden="true" className="mx-auto size-5 text-subtle-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">{t("settings.trash.empty")}</p>
          </div>
        ) : (
          groups.map((group) => {
            const Icon = KIND_ICON[group.kind];
            return (
              <section key={group.kind} className="space-y-2" data-testid={`trash-group-${group.kind}`}>
                <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Icon className="size-3.5" aria-hidden="true" />
                  {t(`settings.trash.kinds.${group.kind}`)} ({group.items.length})
                </h3>
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {group.items.map((item) => {
                    const daysLeft = trashDaysLeft(item.deletedAt);
                    const busy = busyId === item.id;
                    return (
                      <li key={`${item.kind}:${item.id}`} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                          {item.subtitle ? (
                            <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
                          ) : null}
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {t("settings.trash.deletedOn", {
                              date: item.deletedAt ? dateFormatter.format(new Date(item.deletedAt)) : "—",
                            })}
                            {" · "}
                            {t("settings.trash.daysLeft", { count: daysLeft })}
                            {item.merged ? ` · ${t("settings.trash.merged")}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {item.restorable ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={anyBusy}
                              onClick={() => restore.mutate(item)}
                            >
                              {busy && restore.isPending ? <Spinner className="size-4" /> : <RotateCcw />}
                              {t("settings.trash.restore")}
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={anyBusy}
                            onClick={() => void confirmPurgeOne(item)}
                          >
                            {busy && purgeOne.isPending ? <Spinner className="size-4" /> : <Trash2 />}
                            {t("settings.trash.deleteNow")}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
        {isOwner ? <p className="text-xs text-muted-foreground">{t("settings.trash.linkedNote")}</p> : null}
      </CardContent>
    </Card>
  );
}
