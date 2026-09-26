import { useState } from "react";
import { Input } from "../../ui/Input";
import type { Service } from "../../lib/types";

type ServiceComboboxProps = {
  services: Service[];
  value?: string;
  errors?: boolean;
  onChange?: (value: string) => void;
  onSelect?: (service: Service) => void;
};

export default function ServiceCombobox({ services, value = "", onChange, onSelect, errors }: ServiceComboboxProps) {
  const [open, setOpen] = useState(false);

  const filteredServices = services?.filter((service) => service.service_name?.toLowerCase().includes(value.toLowerCase()));

  const exactMatch = services?.some((service) => service.service_name?.toLowerCase() === value.trim().toLowerCase());

  return (
    <div className="relative">
      <Input
        id="service"
        name="service"
        value={value}
        autoComplete="off"
        placeholder="Service"
        className={`w-full rounded-md border px-3 py-2 ${errors ? "border-[#f41f20]" : ""}`}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange?.(e.target.value);
          setOpen(true);
        }}
      />

      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-white shadow">
          {filteredServices.map((service) => (
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
              className="block w-full px-3 py-2 text-left hover:bg-gray-100"
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
    </div>
  );
}
