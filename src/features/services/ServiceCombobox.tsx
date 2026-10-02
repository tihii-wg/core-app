import { useEffect, useRef, useState } from "react";
import { Input } from "../../ui/Input";
import type { Service } from "../../lib/types";

type ServiceComboboxProps = {
  services: Service[];
  value?: string;
  errors?: boolean;
  onChange?: (value: string) => void;
  onCreate?: (serviceName: string, price: number) => void;
  onSelect?: (service: Service) => void;
  allowCreate?: boolean;
};

export default function ServiceCombobox({ services, value, onChange, onCreate, onSelect, errors, allowCreate = true }: ServiceComboboxProps) {
  const [open, setOpen] = useState(false);
  const [uncontrolledValue, setUncontrolledValue] = useState("");
  const [price, setPrice] = useState("");
  const [priceError, setPriceError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);
  const inputValue = value ?? uncontrolledValue;

  function updateValue(next: string) {
    if (value === undefined) {
      setUncontrolledValue(next);
    }
    onChange?.(next);
  }

  function closeMenu() {
    setOpen(false);
    setPrice("");
    setPriceError("");
  }

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        closeMenu();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const filteredServices = services?.filter((service) => service.service_name?.toLowerCase().includes(inputValue.toLowerCase()));

  const exactMatch = services?.some((service) => service.service_name?.toLowerCase() === inputValue.trim().toLowerCase());
  const canCreate = allowCreate && Boolean(inputValue.trim()) && !exactMatch;

  function createService() {
    const serviceName = inputValue.trim();
    if (!canCreate) return;

    if (onCreate) {
      const parsedPrice = Number(price);
      if (price.trim() === "" || Number.isNaN(parsedPrice)) {
        setPriceError("Price is required");
        return;
      }
      if (parsedPrice < 0) {
        setPriceError("Price cannot be negative");
        return;
      }

      onCreate(serviceName, parsedPrice);
    } else {
      onChange?.(serviceName);
    }

    if (value === undefined) {
      setUncontrolledValue("");
    }
    closeMenu();
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        id="service"
        name="service"
        value={inputValue}
        autoComplete="off"
        placeholder="Service"
        className={`w-full rounded-md border px-3 py-2 ${errors ? "border-destructive" : ""}`}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          updateValue(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !canCreate) return;
          e.preventDefault();
          if (onCreate) {
            priceInputRef.current?.focus();
            return;
          }
          createService();
        }}
      />

      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow">
          {filteredServices?.map((service) => (
            <button
              key={service.id}
              type="button"
              className="block w-full px-3 py-2 text-left hover:bg-muted"
              onClick={() => {
                onSelect?.(service);
                onChange?.(service.service_name);
                if (value === undefined) {
                  setUncontrolledValue("");
                }
                closeMenu();
              }}
            >
              {service.service_name}
            </button>
          ))}

          {canCreate && onCreate && (
            <div className="space-y-2 border-t px-3 py-2">
              <p className="text-sm">
                Create: <strong>{inputValue.trim()}</strong>
              </p>
              <div className="flex gap-2">
                <Input
                  ref={priceInputRef}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label="Price"
                  value={price}
                  className={priceError ? "border-destructive" : ""}
                  onChange={(e) => {
                    setPrice(e.target.value);
                    setPriceError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    createService();
                  }}
                />
                <button type="button" className="shrink-0 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90" onClick={createService}>
                  Add
                </button>
              </div>
              {priceError && <p className="text-xs text-destructive">{priceError}</p>}
            </div>
          )}

          {canCreate && !onCreate && (
            <button type="button" className="block w-full px-3 py-2 text-left hover:bg-muted" onClick={createService}>
              Create: <strong>{inputValue.trim()}</strong>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
