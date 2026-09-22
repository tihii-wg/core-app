import { useState } from "react";
import { Input } from "../../ui/Input";
import type { Client } from "../../lib/types";

type ClientComboboxProps = {
  clients: Client[];
  value: string;
  onChange: (value: string) => void;
  onSelect: (client: Client) => void;
};

export default function ClientCombobox({ clients, value, onChange, onSelect }: ClientComboboxProps) {
  const [open, setOpen] = useState(false);

  const filteredClients = clients.filter((client) => client.name?.toLowerCase().includes(value.toLowerCase()));

  const exactMatch = clients.some((client) => client.name?.toLowerCase() === value.trim().toLowerCase());

  return (
    <div className="relative">
      <Input
        value={value}
        autoComplete="off"
        placeholder="Client"
        className="w-full rounded-md border px-3 py-2"
        // onFocus={() => setOpen(true)}
        onChange={(e) => {
          const newValue = e.target.value;
          onChange(newValue);
          setOpen(true);
        }}
      />

      {open && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-white shadow">
          {filteredClients.map((client) => (
            <button
              key={client.id}
              type="button"
              className="block w-full px-3 py-2 text-left hover:bg-gray-100"
              onClick={() => {
                onSelect(client);
                setOpen(false);
              }}
            >
              {client.name}
            </button>
          ))}

          {value.trim() && !exactMatch && (
            <div className="border-t px-3 py-2 text-sm text-gray-900" onClick={() => setOpen(false)}>
              New client: <strong>{value.trim()}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
