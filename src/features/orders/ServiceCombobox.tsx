import { useState } from "react";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
// import type { addNewOrderFormData, Service } from "../../lib/types";
import { Input } from "../../ui/Input";
import type { Service } from "../../lib/types";

interface serviceComboboxProps<T extends FieldValues> {
  services: Service[];
  control: Control<T>;
  name: FieldPath<T>;
}
export default function ServiceCombobox<T extends FieldValues>({ control, name, services }: serviceComboboxProps<T>) {
  const [open, setOpen] = useState(false);

  return (
    <Controller
      name={name}
      control={control}
      rules={{
        required: "Service is required",
      }}
      render={({ field, fieldState }) => {
        const filtersService = services?.filter((service) => service.service_name.toLowerCase().includes(field.value.toLowerCase()));

        const exactMatch = services?.some((service) => service.service_name.toLowerCase() === field.value.trim().toLowerCase());

        return (
          <div className="relative">
            <Input
              id="service"
              value={field.value}
              autoComplete="off"
              onChange={(e) => {
                field.onChange(e.target.value);
                setOpen(true);
              }}
              // onFocus={() => setOpen(true)}
              placeholder="Service"
              className={fieldState.error ? "border-[#f41f20]" : "w-full rounded-md border px-3 py-2"}
            />
            {open && (
              <div className="absolute z-10 mt-1 w-full rounded-md border bg-white sgadow">
                {filtersService?.map((service) => (
                  <button
                    key={service.id}
                    type="button"
                    className="block w-full px-3 py-2 text-left hover:bg-gray-100"
                    onClick={() => {
                      field.onChange(service.service_name);
                      setOpen(false);
                    }}
                  >
                    {service.service_name}
                  </button>
                ))}

                {field.value.trim() && !exactMatch && (
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left hover:bg-gray-10"
                    onClick={() => {
                      field.onChange(field.value.trim());
                      setOpen(false);
                    }}
                  >
                    Create: <strong>{field.value}</strong>
                  </button>
                )}
              </div>
            )}
            {fieldState.error && <p className="text-xs text-[#f41f20]">{fieldState.error.message}</p>}
          </div>
        );
      }}
    />
  );
}
