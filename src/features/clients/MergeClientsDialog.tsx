import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Skeleton } from "../../ui/Skeleton";
import type { Client } from "../../lib/types";
import { getClients, getClient, type MergeClientsPreview } from "../../services/apiClients";
import { getClientVehicles } from "../../services/apiVehicles";
import { useDebounce } from "../../hooks/useDebounce";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import ClientTypeBadge from "./ClientTypeBadge";
import { useMergeClients, useMergeClientsPreview } from "./useMergeClients";
import { cn } from "../../lib/utils";

const MERGE_SHEET_MAX = 640;

type MergeClientsDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Known clients (current list page) used for order counts and default selection. */
  clients: Client[];
  orderCountByClientId: Map<string, number>;
  onMerged: (client: Client) => void;
};

type Step = 1 | 2 | 3;

const PAGE_SIZE = 80;

export function MergeClientsDialog({
  open,
  onClose,
  clients,
  orderCountByClientId,
  onMerged,
}: MergeClientsDialogProps) {
  const { t } = useTranslation();
  const [isCompact, setIsCompact] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(`(max-width: ${MERGE_SHEET_MAX}px)`).matches
      : false,
  );
  const { workspaceId } = useActiveWorkspaceId();
  const [step, setStep] = useState<Step>(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedCache, setSelectedCache] = useState<Map<string, Client>>(new Map());
  const [mainId, setMainId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [preview, setPreview] = useState<MergeClientsPreview | null>(null);
  const [vehicleCounts, setVehicleCounts] = useState<Map<string, number>>(new Map());

  const previewMutation = useMergeClientsPreview();
  const mergeMutation = useMergeClients();

  const listQuery = useQuery({
    queryKey: ["clients", workspaceId, "merge-picker", debouncedSearch],
    queryFn: () => getClients(debouncedSearch, workspaceId, "all"),
    enabled: open && Boolean(workspaceId),
  });

  const listed = listQuery.data ?? [];
  const visible = listed.slice(0, PAGE_SIZE);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(`(max-width: ${MERGE_SHEET_MAX}px)`);
    const onChange = () => setIsCompact(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setSearch("");
      setSelectedIds([]);
      setSelectedCache(new Map());
      setMainId("");
      setNewName("");
      setPreview(null);
      setVehicleCounts(new Map());
    }
  }, [open]);

  useEffect(() => {
    if (!open || !workspaceId || selectedIds.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next = new Map(vehicleCounts);
      await Promise.all(
        selectedIds.map(async (id) => {
          if (next.has(id)) return;
          try {
            const rows = await getClientVehicles(workspaceId, id);
            next.set(id, rows.length);
          } catch {
            next.set(id, 0);
          }
        }),
      );
      if (!cancelled) setVehicleCounts(new Map(next));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only refresh when selection changes
  }, [open, workspaceId, selectedIds.join("|")]);

  const selectedClients = useMemo(() => {
    return selectedIds
      .map((id) => selectedCache.get(id) ?? clients.find((c) => c.id === id) ?? listed.find((c) => c.id === id))
      .filter((c): c is Client => Boolean(c));
  }, [selectedIds, selectedCache, clients, listed]);

  function toggleClient(client: Client) {
    setSelectedCache((prev) => {
      const next = new Map(prev);
      next.set(client.id, client);
      return next;
    });
    setSelectedIds((current) =>
      current.includes(client.id) ? current.filter((id) => id !== client.id) : [...current, client.id],
    );
  }

  async function goToStep2() {
    if (selectedIds.length < 2) return;
    const ranked = [...selectedClients].sort(
      (a, b) => (orderCountByClientId.get(b.id) ?? 0) - (orderCountByClientId.get(a.id) ?? 0) || a.name.localeCompare(b.name),
    );
    const main = ranked[0]?.id ?? selectedIds[0];
    setMainId(main);
    setNewName(ranked[0]?.name ?? "");
    const sources = selectedIds.filter((id) => id !== main);
    try {
      const result = await previewMutation.mutateAsync({ targetClientId: main, sourceClientIds: sources });
      setPreview(result);
      setStep(2);
    } catch {
      // toast handled by caller / mutation consumer — preview mutation has no toast; surface via local state
    }
  }

  useEffect(() => {
    if (step !== 2 || !mainId) return;
    const sources = selectedIds.filter((id) => id !== mainId);
    if (sources.length === 0) return;
    let cancelled = false;
    void previewMutation.mutateAsync({ targetClientId: mainId, sourceClientIds: sources }).then((result) => {
      if (!cancelled) setPreview(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainId]);

  async function confirmMerge() {
    if (!mainId || selectedIds.length < 2 || !newName.trim()) return;
    const sources = selectedIds.filter((id) => id !== mainId);
    try {
      const mergedId = await mergeMutation.mutateAsync({
        targetClientId: mainId,
        sourceClientIds: sources,
        newName: newName.trim(),
      });
      const survivor = await getClient(workspaceId, mergedId);
      if (survivor) onMerged(survivor);
      onClose();
    } catch {
      // toast from mutation
    }
  }

  const sourceNames = selectedClients
    .filter((c) => c.id !== mainId)
    .map((c) => c.name)
    .join(", ");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !mergeMutation.isPending) onClose();
      }}
    >
      <DialogContent
        className={cn(
          "flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg",
          isCompact && "fixed inset-0 h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-none",
        )}
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle>{t("clients.merge.title")}</DialogTitle>
          <DialogDescription>
            {step === 1
              ? t("clients.merge.stepSelect")
              : step === 2
                ? t("clients.merge.stepMain")
                : t("clients.merge.stepConfirm")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === 1 ? (
            <div className="space-y-3">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("clients.merge.searchPlaceholder")}
                aria-label={t("clients.merge.searchPlaceholder")}
              />
              {selectedIds.length > 0 ? (
                <p className="text-xs text-muted-foreground">{t("clients.merge.selectedCount", { count: selectedIds.length })}</p>
              ) : null}
              {listQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : listQuery.isError ? (
                <p className="text-sm text-destructive">{t("clients.errors.loadFailed")}</p>
              ) : visible.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("clients.merge.noMatches")}</p>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {visible.map((client) => {
                    const checked = selectedIds.includes(client.id);
                    const orders = orderCountByClientId.get(client.id) ?? 0;
                    const vehicles = vehicleCounts.get(client.id);
                    return (
                      <li key={client.id}>
                        <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/60">
                          <input
                            type="checkbox"
                            className="mt-1 size-4 shrink-0"
                            checked={checked}
                            onChange={() => toggleClient(client)}
                          />
                          <span className="min-w-0 flex-1 space-y-0.5">
                            <span className="flex min-w-0 flex-wrap items-center gap-2">
                              <span className="font-medium text-foreground [overflow-wrap:anywhere]">{client.name}</span>
                              <ClientTypeBadge clientType={client.client_type} />
                            </span>
                            <span className="block text-xs text-muted-foreground tabular-nums">
                              {[client.phone, client.email].filter(Boolean).join(" · ") || "—"}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {t("clients.merge.rowMeta", {
                                orders,
                                vehicles: vehicles ?? "…",
                              })}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              {listed.length > PAGE_SIZE ? (
                <p className="text-xs text-muted-foreground">{t("clients.merge.truncateHint", { count: Number(PAGE_SIZE) })}</p>
              ) : null}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-foreground">{t("clients.merge.mainLabel")}</legend>
                {selectedClients.map((client) => (
                  <label key={client.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="merge-main"
                      checked={mainId === client.id}
                      onChange={() => {
                        setMainId(client.id);
                        setNewName(client.name);
                      }}
                    />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {client.name}{" "}
                      <span className="text-muted-foreground">
                        ({t("clients.merge.ordersShort", { count: orderCountByClientId.get(client.id) ?? 0 })})
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <div className="space-y-1.5">
                <Label htmlFor="merge-client-name">{t("clients.merge.nameLabel")}</Label>
                <Input
                  id="merge-client-name"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  required
                />
              </div>

              {previewMutation.isPending && !preview ? (
                <Skeleton className="h-16 w-full" />
              ) : preview ? (
                <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                  <p className="font-medium text-foreground">
                    {t("clients.merge.willMove", {
                      orders: preview.orders,
                      vehicles: preview.vehicles,
                      invoices: preview.invoices,
                      payments: preview.payments,
                    })}
                  </p>
                  {preview.sourceNotes.length > 0 ? (
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p>{t("clients.merge.notesAppendHint")}</p>
                      <ul className="list-disc space-y-0.5 pl-4">
                        {preview.sourceNotes.map((note) => (
                          <li key={note.id}>
                            {[note.name, note.phone, note.email].filter(Boolean).join(", ")}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : previewMutation.isError ? (
                <p className="text-sm text-destructive">
                  {(previewMutation.error as Error)?.message || t("clients.merge.errors.previewFailed")}
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            <p className="text-sm text-muted-foreground">
              {t("clients.merge.confirmBody", { sources: sourceNames, name: newName.trim() })}
            </p>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-5 py-4">
          {step === 1 ? (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="button" disabled={selectedIds.length < 2 || previewMutation.isPending} onClick={() => void goToStep2()}>
                {previewMutation.isPending ? t("common.loading") : t("clients.merge.next")}
              </Button>
            </>
          ) : null}
          {step === 2 ? (
            <>
              <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={mergeMutation.isPending}>
                {t("common.back")}
              </Button>
              <Button
                type="button"
                disabled={!mainId || !newName.trim() || previewMutation.isPending}
                onClick={() => setStep(3)}
              >
                {t("clients.merge.next")}
              </Button>
            </>
          ) : null}
          {step === 3 ? (
            <>
              <Button type="button" variant="outline" onClick={() => setStep(2)} disabled={mergeMutation.isPending}>
                {t("common.cancel")}
              </Button>
              <Button type="button" disabled={mergeMutation.isPending} onClick={() => void confirmMerge()}>
                {mergeMutation.isPending ? t("clients.merge.merging") : t("clients.merge.confirm")}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
