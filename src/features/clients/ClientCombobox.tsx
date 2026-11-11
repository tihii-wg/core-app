import { useEffect, useRef, useState, type Ref } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Input } from "../../ui/Input";
import type { Client } from "../../lib/types";
import { phoneMatchesQuery } from "../../lib/phoneSearch";
import { vehicleMakeModelLabel } from "../../services/apiVehicles";
import type { VehicleRegistrationSearchHit } from "../../services/apiVehicles";
import { industryClientCopy } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import ClientTypeBadge from "./ClientTypeBadge";

type ClientComboboxProps = {
  clients: Client[];
  value: string;
  errors?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onChange: (value: string) => void;
  onSelect: (client: Client) => void;
  /** Explicit create action — always available when the typed name is non-empty. */
  onCreateRequest?: (name: string) => void;
  /** Plate / make / model hits from workspace vehicle search (create-order). */
  vehicleHits?: VehicleRegistrationSearchHit[];
  vehicleHitsLoading?: boolean;
  vehicleHitsError?: boolean;
  onSelectVehicle?: (hit: VehicleRegistrationSearchHit) => void;
  /** Override the industry placeholder (e.g. mention plate / phone / vehicle search). */
  placeholder?: string;
};

function clientSecondaryLabel(client: Client, emptyPhone: string) {
  const phone = client.phone?.trim();
  if (phone) return phone;
  if (client.tax_id?.trim()) return client.tax_id.trim();
  if (client.contact_person?.trim()) return client.contact_person.trim();
  return emptyPhone;
}

function vehicleHitSecondary(hit: VehicleRegistrationSearchHit, untitled: string) {
  const makeModel = vehicleMakeModelLabel({
    make: hit.make,
    model: hit.model,
    year: hit.year,
  });
  const plate = hit.licensePlate?.trim() ?? "";
  if (makeModel && plate) return `${makeModel} · ${plate}`;
  if (makeModel) return makeModel;
  if (plate) return plate;
  return untitled;
}

function clientMatchesComboboxQuery(client: Client, rawQuery: string): boolean {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return true;
  const name = client.name?.toLowerCase() ?? "";
  const taxId = client.tax_id?.toLowerCase() ?? "";
  if (name.includes(normalized) || taxId.includes(normalized)) return true;
  if (client.phone?.trim() && phoneMatchesQuery(client.phone, rawQuery)) return true;
  return false;
}

export default function ClientCombobox({
  clients,
  value,
  onChange,
  onSelect,
  onCreateRequest,
  errors,
  inputRef,
  vehicleHits = [],
  vehicleHitsLoading = false,
  vehicleHitsError = false,
  onSelectVehicle,
  placeholder,
}: ClientComboboxProps) {
  const { t } = useTranslation();
  const { workflow } = useIndustryWorkflow();
  const copy = industryClientCopy(workflow);
  // Closed until the user focuses/clicks/types — never open on mount.
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    // pointerdown (not blur) so a click on an option is processed before close.
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  // Keep every matching row — do not dedupe by name. Identity is client.id.
  // Phone uses digit/variant matching so server phone hits (069 ↔ +373) are not dropped.
  const filteredClients = clients.filter((client) => clientMatchesComboboxQuery(client, value));

  const canCreate = Boolean(onCreateRequest) && value.trim().length > 0;
  const emptyPhone = t("clients.combobox.noPhone");
  const untitledVehicle = t("vehicles.untitled");
  const hasVehicleSection = Boolean(onSelectVehicle);
  const showVehicleHits = hasVehicleSection && (vehicleHitsLoading || vehicleHitsError || vehicleHits.length > 0 || value.trim().length >= 2);
  const noClientMatches = filteredClients.length === 0;
  const noVehicleMatches = !vehicleHitsLoading && !vehicleHitsError && vehicleHits.length === 0;
  const showEmpty = noClientMatches && (!hasVehicleSection || noVehicleMatches) && !vehicleHitsLoading;

  function selectClient(client: Client) {
    onSelect(client);
    setOpen(false);
  }

  function selectVehicle(hit: VehicleRegistrationSearchHit) {
    onSelectVehicle?.(hit);
    setOpen(false);
  }

  function requestCreate() {
    onCreateRequest?.(value.trim());
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        id="client"
        name="client"
        value={value}
        autoComplete="off"
        placeholder={placeholder ?? copy.comboboxPlaceholder}
        aria-label={placeholder ?? copy.comboboxPlaceholder}
        aria-invalid={errors || undefined}
        aria-expanded={open}
        aria-controls="client-combobox-list"
        role="combobox"
        className={`w-full rounded-md border px-3 py-2 ${errors ? "border-destructive" : ""}`}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
      />

      {open ? (
        <div
          id="client-combobox-list"
          role="listbox"
          className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover shadow"
        >
          {showVehicleHits ? (
            <div className="border-b border-border" data-testid="client-combobox-vehicle-hits">
              <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-subtle-foreground">
                {t("clients.combobox.vehicleMatches")}
              </p>
              {vehicleHitsLoading ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">{t("clients.combobox.vehicleSearchLoading")}</p>
              ) : vehicleHitsError ? (
                <p className="px-3 py-2 text-sm text-destructive">{t("clients.combobox.vehicleSearchFailed")}</p>
              ) : vehicleHits.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">{t("clients.combobox.noVehicleMatches")}</p>
              ) : (
                vehicleHits.map((hit) => (
                  <button
                    key={hit.vehicleId}
                    type="button"
                    role="option"
                    data-testid={`client-combobox-vehicle-${hit.vehicleId}`}
                    className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left hover:bg-muted"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectVehicle(hit)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">{hit.client.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {vehicleHitSecondary(hit, untitledVehicle)}
                      </span>
                    </span>
                    <ClientTypeBadge clientType={hit.client.client_type} />
                  </button>
                ))
              )}
            </div>
          ) : null}

          {showEmpty ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t("clients.combobox.noMatches")}</p>
          ) : filteredClients.length > 0 ? (
            <>
              {showVehicleHits ? (
                <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-subtle-foreground">
                  {t("clients.combobox.clientMatches")}
                </p>
              ) : null}
              {filteredClients.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  role="option"
                  className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left hover:bg-muted"
                  // Keep focus on the input so the list is not torn down before click.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectClient(client)}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{client.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{clientSecondaryLabel(client, emptyPhone)}</span>
                  </span>
                  <ClientTypeBadge clientType={client.client_type} />
                </button>
              ))}
            </>
          ) : null}

          {canCreate ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
              onMouseDown={(event) => event.preventDefault()}
              onClick={requestCreate}
            >
              <Plus className="size-4 shrink-0" aria-hidden />
              <span>
                <Trans i18nKey="clients.combobox.createNew" values={{ name: value.trim() }} components={{ strong: <strong /> }} />
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
