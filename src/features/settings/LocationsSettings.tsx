import { useState, type FormEvent } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { useConfirm } from "../../ui/ConfirmProvider";
import { useGetLocations } from "../locations/useGetLocations";
import {
  useCreateLocation,
  useDeleteLocation,
  useSetDefaultLocation,
} from "../locations/useLocationMutations";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useCanEditWorkspaceSettings } from "../workspaces/useWorkspaceSubscription";

const emptyForm = { name: "", address: "", phone: "", color: "#2563eb", code: "", isDefault: false };

export function LocationsSettings() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { data = [], isLoading, error } = useGetLocations();
  const canEdit = useCanEditWorkspaceSettings(useActiveWorkspaceRole());
  const createLocation = useCreateLocation();
  const setDefault = useSetDefaultLocation();
  const deleteLocation = useDeleteLocation();
  const [form, setForm] = useState(emptyForm);
  const busy = createLocation.isPending || setDefault.isPending || deleteLocation.isPending;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    createLocation.mutate(
      { ...form, isDefault: form.isDefault || data.length === 0 },
      { onSuccess: () => setForm(emptyForm) },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.locations.title")}</CardTitle>
        <CardDescription>{t("settings.locations.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <p className="text-sm text-muted-foreground">{t("settings.locations.loading")}</p> : null}
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        {!isLoading && !error && data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.locations.empty")}</p>
        ) : null}
        {data.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.map((location) => (
              <li key={location.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {location.color ? (
                      <span
                        className="size-2.5 shrink-0 rounded-full ring-1 ring-border"
                        style={{ background: location.color }}
                        aria-hidden
                      />
                    ) : null}
                    <p className="text-sm font-medium text-foreground">{location.name}</p>
                    {location.code ? <span className="text-xs text-muted-foreground">({location.code})</span> : null}
                    {location.isDefault ? (
                      <span className="text-xs text-muted-foreground">{t("settings.locations.default")}</span>
                    ) : null}
                  </div>
                  {location.address ? <p className="mt-0.5 text-xs text-muted-foreground">{location.address}</p> : null}
                  {location.phone ? <p className="text-xs text-muted-foreground">{location.phone}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="mr-2 text-xs text-muted-foreground">
                    {location.isActive ? t("settings.locations.active") : t("settings.locations.inactive")}
                  </span>
                  {canEdit ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy || location.isDefault}
                        aria-label={t("settings.locations.setDefault")}
                        title={t("settings.locations.setDefault")}
                        onClick={() => setDefault.mutate(location.id)}
                      >
                        <Star />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy || location.isDefault}
                        aria-label={t("settings.locations.delete")}
                        title={location.isDefault ? t("settings.locations.cannotDeleteDefault") : t("settings.locations.delete")}
                        onClick={() => {
                          void (async () => {
                            if (
                              !(await confirm({
                                title: t("common.deleteTitle"),
                                description: t("settings.locations.deleteConfirm", { name: location.name }),
                                confirmLabel: t("common.delete"),
                                tone: "destructive",
                              }))
                            ) {
                              return;
                            }
                            deleteLocation.mutate(location.id);
                          })();
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {canEdit ? (
          <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
            <p className="text-sm font-medium text-foreground sm:col-span-2">{t("settings.locations.form.title")}</p>
            <div className="space-y-1.5">
              <Label htmlFor="location-name">{t("settings.locations.form.name")}</Label>
              <Input
                id="location-name"
                value={form.name}
                required
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location-code">{t("settings.locations.form.code")}</Label>
              <Input id="location-code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location-address">{t("settings.locations.form.address")}</Label>
              <Input
                id="location-address"
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location-phone">{t("settings.locations.form.phone")}</Label>
              <Input id="location-phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location-color">{t("settings.locations.form.color")}</Label>
              <Input
                id="location-color"
                type="color"
                className="w-20 p-1"
                value={form.color}
                onChange={(event) => setForm({ ...form, color: event.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
              />
              {t("settings.locations.form.makeDefault")}
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy || !form.name.trim()}>
                <Plus />
                {createLocation.isPending ? t("common.saving") : t("settings.locations.form.submit")}
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
