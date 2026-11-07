import * as React from "react";
import { currentIntlLocale } from "../i18n";
import { formatMileageInput, parseMileageInput } from "../lib/mileage";
import { cn } from "../lib/utils";
import { Input } from "./Input";

export type MileageInputProps = Omit<React.ComponentProps<"input">, "type" | "inputMode"> & {
  /** Optional unit abbreviation shown inside the field (km / mi). */
  unitSuffix?: string;
  /** Intl locale for blur reformatting; defaults to the active UI locale. */
  locale?: string;
};

/**
 * Text mileage field: free typing of digits/separators; on blur, reformats when valid.
 * Invalid text is left as typed so react-hook-form validation can surface the error.
 */
export const MileageInput = React.forwardRef<HTMLInputElement, MileageInputProps>(function MileageInput(
  { unitSuffix, locale, className, onBlur, onChange, value, defaultValue, ...props },
  ref,
) {
  const resolvedLocale = locale ?? currentIntlLocale();

  function reformatIfValid(raw: string): string | null {
    try {
      const parsed = parseMileageInput(raw);
      if (parsed == null) return raw.trim() === "" ? "" : null;
      return formatMileageInput(parsed, resolvedLocale);
    } catch {
      return null;
    }
  }

  function handleBlur(event: React.FocusEvent<HTMLInputElement>) {
    const formatted = reformatIfValid(event.target.value);
    if (formatted != null && formatted !== event.target.value) {
      event.target.value = formatted;
      onChange?.({
        ...event,
        target: event.target,
        currentTarget: event.currentTarget,
      });
    }
    onBlur?.(event);
  }

  return (
    <div className={cn("relative w-full min-w-0", unitSuffix ? "max-w-full sm:max-w-[12rem]" : undefined)}>
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="numeric"
        className={cn("w-full min-w-0", unitSuffix ? "pr-10" : undefined, className)}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        onBlur={handleBlur}
      />
      {unitSuffix ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
          {unitSuffix}
        </span>
      ) : null}
    </div>
  );
});

MileageInput.displayName = "MileageInput";
