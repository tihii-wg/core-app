import { useState } from "react";
// import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
// import type { addNewOrderFormData, Service } from "../../lib/types";
import { Input } from "../../ui/Input";
import type { Service } from "../../lib/types";

type serviceComboboxProps = {
  services: Service[];
  value?: string;
  onChange?: (value: string) => void;
  onSelect?: (service: Service) => void;
};
export default function ServiceCombobox({ services, value = "", onChange, onSelect }: serviceComboboxProps) {
  const [open, setOpen] = useState(false);

  const filteredSevices = services?.filter((service) => service.service_name?.toLowerCase().includes(value.toLowerCase()));

  const exactMatch = services?.some((service) => service.service_name.toLowerCase() === value.trim().toLowerCase());

  return (
    <div className="relative">
      <Input
        value={value}
        autoComplete="off"
        onChange={(e) => {
          onChange?.(e.target.value);
          setOpen(true);
        }}
        // onFocus={() => setOpen(true)}
        placeholder="Service"
        className={"w-full rounded-md border px-3 py-2"}
      />
      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-white sgadow">
          {filteredSevices?.map((service) => (
            <button
              key={service.id}
              type="button"
              className="block w-full px-3 py-2 text-left hover:bg-gray-100"
              onClick={() => {
                onSelect?.(service);
                onChange?.(service.service_name);
                setOpen(false);
              }}
            >
              {service.service_name}
            </button>
          ))}

          {value.trim() && !exactMatch && (
            <button
              type="button"
              className="block w-full px-3 py-2 text-left hover:bg-gray-10"
              onClick={() => {
                onChange?.(value.trim());
                setOpen(false);
              }}
            >
              Create: <strong>{value.trim()}</strong>
            </button>
          )}
        </div>
      )}
      {/* {fieldState.error && <p className="text-xs text-[#f41f20]">{fieldState.error.message}</p>} */}
    </div>
  );
}
