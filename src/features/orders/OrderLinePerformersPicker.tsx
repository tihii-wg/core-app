import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { cn } from "../../lib/utils";
import type { AssignableTechnician } from "./assignableTechnicians";

type OrderLinePerformersPickerProps = {
  /** Ordered performer ids: first = main performer, the rest = additional ones. */
  value: string[];
  options: AssignableTechnician[];
  /** Names for ids that are not in `options` any more (e.g. a dismissed employee still on the line). */
  knownNames?: Record<string, string>;
  disabled?: boolean;
  saving?: boolean;
  idPrefix: string;
  onChange: (ids: string[]) => void;
  className?: string;
};

/**
 * Several performers on one service line: chips with a remove button + a select to add one more.
 * The first chip is the main performer (order_services.technician_id); removing it promotes the next one.
 */
export default function OrderLinePerformersPicker({
  value,
  options,
  knownNames,
  disabled = false,
  saving = false,
  idPrefix,
  onChange,
  className,
}: OrderLinePerformersPickerProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  // Remount the select after each pick so it shows its placeholder again.
  const [selectKey, setSelectKey] = useState(0);

  useLayoutEffect(() => {
    setPortalContainer(rootRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null);
  }, []);

  const nameOf = (id: string) => options.find((option) => option.id === id)?.name ?? knownNames?.[id] ?? "—";
  const available = options.filter((option) => !value.includes(option.id));
  const locked = disabled || saving;

  return (
    <div ref={rootRef} className={cn("space-y-1.5", className)} data-testid={`${idPrefix}-performers`}>
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id, index) => (
            <span
              key={id}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                index === 0 ? "border-primary/40 bg-primary/10 text-foreground" : "border-border bg-muted text-foreground",
              )}
            >
              <span className="min-w-0 truncate">{nameOf(id)}</span>
              <button
                type="button"
                className="-mr-1 rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
                aria-label={t("orders.team.removePerformer", { name: nameOf(id) })}
                disabled={locked}
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(value.filter((item) => item !== id));
                }}
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {available.length > 0 ? (
        <Select
          key={selectKey}
          onValueChange={(next) => {
            setSelectKey((key) => key + 1);
            if (next && !value.includes(next)) onChange([...value, next]);
          }}
          disabled={locked}
        >
          <SelectTrigger id={`${idPrefix}-add-performer`} className="h-8 w-full text-xs sm:max-w-[14rem]">
            <SelectValue
              placeholder={value.length === 0 ? t("orders.detail.addPerformer") : t("orders.team.addAnotherPerformer")}
            />
          </SelectTrigger>
          <SelectContent container={portalContainer} position="popper" className="z-[80]">
            {available.map((technician) => (
              <SelectItem key={technician.id} value={technician.id}>
                {technician.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
