import { useEffect, useRef, useState, type Ref } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Input } from "../../ui/Input";
import type { Client } from "../../lib/types";
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
};

function clientSecondaryLabel(client: Client, emptyPhone: string) {
  const phone = client.phone?.trim();
  if (phone) return phone;
  if (client.tax_id?.trim()) return client.tax_id.trim();
  if (client.contact_person?.trim()) return client.contact_person.trim();
  return emptyPhone;
}

export default function ClientCombobox({
  clients,
  value,
  onChange,
  onSelect,
  onCreateRequest,
  errors,
  inputRef,
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

  const normalized = value.trim().toLowerCase();
  // Keep every matching row — do not dedupe by name. Identity is client.id.
  const filteredClients = clients.filter((client) => {
    if (!normalized) return true;
    const name = client.name?.toLowerCase() ?? "";
    const phone = client.phone?.toLowerCase() ?? "";
    const taxId = client.tax_id?.toLowerCase() ?? "";
    return name.includes(normalized) || phone.includes(normalized) || taxId.includes(normalized);
  });

  const canCreate = Boolean(onCreateRequest) && value.trim().length > 0;
  const emptyPhone = t("clients.combobox.noPhone");

  function selectClient(client: Client) {
    onSelect(client);
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
        placeholder={copy.comboboxPlaceholder}
        aria-label={copy.comboboxPlaceholder}
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
          {filteredClients.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t("clients.combobox.noMatches")}</p>
          ) : (
            filteredClients.map((client) => (
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
            ))
          )}

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
