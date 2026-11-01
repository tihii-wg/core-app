import { useMemo, useState, type FormEvent } from "react";
import { Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import type { BinLocationRecord, WarehouseRecord, WarehouseType } from "../../services/apiWarehouses";
import type { WarehouseStockRecord } from "../../services/apiWarehouseStock";
import { useGetLocations } from "../locations/useGetLocations";
import { useGetBinLocations, useGetWarehouses } from "../warehouses/useGetWarehouses";
import { useGetWarehouseStock } from "../warehouses/useGetWarehouseStock";
import {
  useCreateWarehouse,
  useSetDefaultWarehouse,
  useSoftDeleteWarehouse,
  useUpdateWarehouse,
} from "../warehouses/useWarehouseMutations";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useCanEditWorkspaceSettings } from "../workspaces/useWorkspaceSubscription";

const STOCK_PREVIEW_LIMIT = 8;

type WarehouseForm = {
  name: string;
  warehouseType: WarehouseType;
  locationId: string;
  isDefault: boolean;
  isActive: boolean;
};

const emptyForm: WarehouseForm = {
  name: "",
  warehouseType: "location",
  locationId: "",
  isDefault: false,
  isActive: true,
};

function formFromWarehouse(warehouse: WarehouseRecord): WarehouseForm {
  return {
    name: warehouse.name,
    warehouseType: warehouse.warehouseType,
    locationId: warehouse.locationId ?? "",
    isDefault: warehouse.isDefault,
    isActive: warehouse.isActive,
  };
}

export function WarehousesSettings() {
  const { t } = useTranslation();
  const { data: warehouses = [], isLoading, error } = useGetWarehouses();
  const { data: bins = [] } = useGetBinLocations();
  const { data: locations = [] } = useGetLocations();
  const { data: stock = [] } = useGetWarehouseStock();
  const canEdit = useCanEditWorkspaceSettings(useActiveWorkspaceRole());
  const createWarehouse = useCreateWarehouse();
  const updateWarehouse = useUpdateWarehouse();
  const setDefault = useSetDefaultWarehouse();
  const softDelete = useSoftDeleteWarehouse();

  const [form, setForm] = useState<WarehouseForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const busy =
    createWarehouse.isPending || updateWarehouse.isPending || setDefault.isPending || softDelete.isPending;

  const stockByWarehouse = useMemo(() => {
    const map = new Map<string, WarehouseStockRecord[]>();
    for (const row of stock) {
      const list = map.get(row.warehouseId) ?? [];
      list.push(row);
      map.set(row.warehouseId, list);
    }
    return map;
  }, [stock]);

  const binsByWarehouse = useMemo(() => {
    const map = new Map<string, BinLocationRecord[]>();
    for (const bin of bins) {
      const list = map.get(bin.warehouseId) ?? [];
      list.push(bin);
      map.set(bin.warehouseId, list);
    }
    return map;
  }, [bins]);
  const locationNames = useMemo(() => new Map(locations.map((location) => [location.id, location.name])), [locations]);

  const reset = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || busy) return;
    const input = {
      name: form.name,
      warehouseType: form.warehouseType,
      locationId: form.locationId || null,
      isDefault: form.isDefault || (!editingId && warehouses.length === 0),
      isActive: form.isActive,
    };
    if (editingId) {
      updateWarehouse.mutate({ id: editingId, input }, { onSuccess: reset });
    } else {
      createWarehouse.mutate(input, { onSuccess: reset });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.warehouses.title")}</CardTitle>
        <CardDescription>{t("settings.warehouses.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <p className="text-sm text-muted-foreground">{t("settings.warehouses.loading")}</p> : null}
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        {!isLoading && !error && warehouses.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.warehouses.empty")}</p>
        ) : null}
        {warehouses.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {warehouses.map((warehouse) => {
              const warehouseBins = binsByWarehouse.get(warehouse.id) ?? [];
              const warehouseStock = stockByWarehouse.get(warehouse.id) ?? [];
              const stockedProductCount = warehouseStock.filter((row) => row.quantity > 0).length;
              const hasStock = warehouseStock.some((row) => row.quantity > 0);
              const locationName = warehouse.locationId ? locationNames.get(warehouse.locationId) : undefined;
              return (
                <li key={warehouse.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{warehouse.name}</p>
                      {warehouse.isDefault ? (
                        <span className="text-xs text-muted-foreground">{t("settings.warehouses.default")}</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t(`settings.warehouses.types.${warehouse.warehouseType}`)}
                      {locationName ? ` · ${locationName}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {warehouseBins.length === 0
                        ? t("settings.warehouses.noBins")
                        : `${t("settings.warehouses.bins")}: ${warehouseBins.map((bin) => bin.name).join(", ")}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.warehouses.productCount", { count: stockedProductCount })}
                    </p>
                    {warehouseStock.length > 0 ? (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-foreground">{t("settings.warehouses.stock")}</p>
                        <ul className="mt-1 space-y-0.5">
                          {warehouseStock.slice(0, STOCK_PREVIEW_LIMIT).map((row) => (
                            <li key={row.id} className="flex justify-between gap-4 text-xs text-muted-foreground">
                              <span className="truncate">{row.itemName || t("settings.warehouses.unknownItem")}</span>
                              <span
                                className={
                                  row.minQuantity != null && row.quantity < row.minQuantity
                                    ? "shrink-0 font-medium text-destructive"
                                    : "shrink-0 text-foreground"
                                }
                              >
                                {row.quantity}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {warehouseStock.length > STOCK_PREVIEW_LIMIT ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("settings.warehouses.stockMore", { count: warehouseStock.length - STOCK_PREVIEW_LIMIT })}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="mr-2 text-xs text-muted-foreground">
                      {warehouse.isActive ? t("settings.warehouses.active") : t("settings.warehouses.inactive")}
                    </span>
                    {canEdit ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy || warehouse.isDefault}
                          aria-label={t("settings.warehouses.setDefault")}
                          title={t("settings.warehouses.setDefault")}
                          onClick={() => setDefault.mutate(warehouse.id)}
                        >
                          <Star />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy}
                          aria-label={t("settings.warehouses.edit")}
                          title={t("settings.warehouses.edit")}
                          onClick={() => {
                            setEditingId(warehouse.id);
                            setForm(formFromWarehouse(warehouse));
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy || warehouse.isDefault || hasStock}
                          aria-label={t("settings.warehouses.delete")}
                          title={
                            warehouse.isDefault
                              ? t("settings.warehouses.cannotDeleteDefault")
                              : hasStock
                                ? t("settings.warehouses.errors.cannotDeleteWithStock")
                                : t("settings.warehouses.delete")
                          }
                          onClick={() => {
                            if (window.confirm(t("settings.warehouses.deleteConfirm", { name: warehouse.name }))) {
                              softDelete.mutate(warehouse.id);
                            }
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        {canEdit ? (
          <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
            <p className="text-sm font-medium text-foreground sm:col-span-2">
              {editingId ? t("settings.warehouses.form.editTitle") : t("settings.warehouses.form.title")}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="warehouse-name">{t("settings.warehouses.form.name")}</Label>
              <Input
                id="warehouse-name"
                value={form.name}
                required
                maxLength={120}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="warehouse-type">{t("settings.warehouses.form.type")}</Label>
              <Select
                value={form.warehouseType}
                onValueChange={(value) => setForm({ ...form, warehouseType: value as WarehouseType })}
              >
                <SelectTrigger id="warehouse-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="location">{t("settings.warehouses.types.location")}</SelectItem>
                  <SelectItem value="company">{t("settings.warehouses.types.company")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {locations.length > 0 ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="warehouse-location">{t("settings.warehouses.form.location")}</Label>
                <Select
                  value={form.locationId || "none"}
                  onValueChange={(value) => setForm({ ...form, locationId: value === "none" ? "" : value })}
                >
                  <SelectTrigger id="warehouse-location">
                    <SelectValue placeholder={t("settings.warehouses.form.locationPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("settings.warehouses.form.noLocation")}</SelectItem>
                    {locations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
              />
              {t("settings.warehouses.form.makeDefault")}
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
              />
              {t("settings.warehouses.form.isActive")}
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy || !form.name.trim()}>
                {editingId ? null : <Plus />}
                {busy
                  ? t("common.saving")
                  : editingId
                    ? t("settings.warehouses.form.save")
                    : t("settings.warehouses.form.submit")}
              </Button>
              {editingId ? (
                <Button type="button" variant="outline" disabled={busy} onClick={reset}>
                  <X />
                  {t("common.cancel")}
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("settings.warehouses.note")}</p>
      </CardContent>
    </Card>
  );
}
