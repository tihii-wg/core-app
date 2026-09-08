import { useState } from "react";
import { Controller, type Control } from "react-hook-form";
import type { addNewOrderFormData, Service } from "../../lib/types";
import { Input } from "../../ui/Input";

type Props = {
  control: Control<addNewOrderFormData>;
  services: Service[];
};
export default function ServiceCombobox({ control, services }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Controller
      name="serviceName"
      control={control}
      rules={{
        required: "Service is required",
      }}
      render={({ field, fieldState }) => {
        const filtersService = services.filter((service) => service.name.toLowerCase().includes(field.value.toLowerCase()));

        const exactMatch = services.some((service) => service.name.toLowerCase() === field.value.trim().toLowerCase());

        return (
          <div className="relative">
            <Input
              id="service"
              value={field.value}
              onChange={(e) => {
                field.onChange(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="Service"
              className={fieldState.error ? "border-[#f41f20]" : "w-full rounded-md border px-3 py-2"}
            />
            {open && (
              <div className="absolute z-10 mt-1 w-full rounded-md border bg-white sgadow">
                {filtersService.map((service) => (
                  <button
                    key={service.id}
                    type="button"
                    className="block w-full px-3 py-2 text-left hover:bg-gray-100"
                    onClick={() => {
                      field.onChange(service.name);
                      setOpen(false);
                    }}
                  >
                    {service.name}
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
