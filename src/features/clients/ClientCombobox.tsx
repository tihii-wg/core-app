import { useState, type Ref } from "react";
import { Trans } from "react-i18next";
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
};

export default function ClientCombobox({ clients, value, onChange, onSelect, errors, inputRef }: ClientComboboxProps) {
  const { workflow } = useIndustryWorkflow();
  const copy = industryClientCopy(workflow);
  const [open, setOpen] = useState(false);

  const filteredClients = clients.filter((client) => client.name?.toLowerCase().includes(value.toLowerCase()));

  const exactMatch = clients.some((client) => client.name?.toLowerCase() === value.trim().toLowerCase());

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        id="client"
        name="client"
        value={value}
        autoComplete="off"
        placeholder={copy.comboboxPlaceholder}
        aria-invalid={errors || undefined}
        className={`w-full rounded-md border px-3 py-2 ${errors ? "border-destructive" : ""}`}
        // className="w-full rounded-md border px-3 py-2"
        // onFocus={() => setOpen(true)}
        onChange={(e) => {
          const newValue = e.target.value;
          onChange(newValue);
          setOpen(true);
        }}
      />

      {open && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover shadow">
          {filteredClients.map((client) => (
            <button
              key={client.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted"
              onClick={() => {
                onSelect(client);
                setOpen(false);
              }}
            >
              <span>{client.name}</span>{" "}
              <ClientTypeBadge clientType={client.client_type} />
            </button>
          ))}

          {value.trim() && !exactMatch && (
            <div className="cursor-pointer border-t px-3 py-2 text-sm text-foreground" onClick={() => setOpen(false)}>
              <Trans i18nKey="clients.combobox.newClient" values={{ name: value.trim() }} components={{ strong: <strong /> }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
