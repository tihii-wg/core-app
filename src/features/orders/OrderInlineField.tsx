import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Textarea } from "../../ui/Textarea";

export type OrderInlineFieldKind = "text" | "textarea" | "number" | "date" | "datetime-local" | "select" | "checkbox";

export type OrderInlineFieldValue = string | boolean;

export type OrderInlineFieldOption = { value: string; label: string };

export type OrderInlineFieldProps = {
  label: string;
  /** Registry key (`description`, `custom:foo`, …) — exposed as `data-edit-field`. */
  fieldKey: string;
  /** Read-only display content. Empty (null / "") renders the placeholder when editable, nothing otherwise. */
  value: ReactNode;
  /** Initial value of the editor control. */
  editValue: string | number | boolean | null | undefined;
  kind?: OrderInlineFieldKind;
  options?: OrderInlineFieldOption[];
  required?: boolean;
  /** When false the value is plain text (no hover / button). */
  editable: boolean;
  mono?: boolean;
  /** Hide the value behind bullets with a show/hide toggle (device passcode). */
  masked?: boolean;
  /** Overrides `orders.detail.inlineEmpty`. */
  emptyPlaceholder?: string;
  isEditing: boolean;
  onRequestEdit: () => void;
  onCancel: () => void;
  /** Persist the draft. Reject to keep the editor open — the message is shown under the control. */
  onSave: (next: OrderInlineFieldValue) => Promise<void>;
  /** Reports whether the draft differs from `editValue` (drives unsaved-changes confirmation). */
  onDirtyChange?: (dirty: boolean) => void;
  saving?: boolean;
  errorMessage?: string | null;
  className?: string;
  /** Extra classes for the displayed value (e.g. `font-normal` for long descriptions). */
  valueClassName?: string;
};

const NONE_OPTION = "__inline_none__";

function toDraft(kind: OrderInlineFieldKind, editValue: OrderInlineFieldProps["editValue"]): OrderInlineFieldValue {
  if (kind === "checkbox") return editValue === true || editValue === "true";
  if (editValue == null || typeof editValue === "boolean") return "";
  return String(editValue);
}

function isEmptyDisplay(value: ReactNode): boolean {
  return value == null || value === "" || value === false;
}

/** Click-to-edit order field: plain text when locked, button when editable, control + Save / Cancel when editing. */
export function OrderInlineField({
  label,
  fieldKey,
  value,
  editValue,
  kind = "text",
  options = [],
  required = false,
  editable,
  mono = false,
  masked = false,
  emptyPlaceholder,
  isEditing,
  onRequestEdit,
  onCancel,
  onSave,
  onDirtyChange,
  saving = false,
  errorMessage = null,
  className,
  valueClassName: valueClassNameOverride,
}: OrderInlineFieldProps) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  const empty = isEmptyDisplay(value);

  if (!editable && empty) return null;

  const valueClassName = cn(
    mono
      ? "font-mono text-[13px] [overflow-wrap:anywhere] text-foreground"
      : "font-medium [overflow-wrap:anywhere] text-foreground",
    valueClassNameOverride,
  );

  const shown: ReactNode = empty ? null : masked && !revealed ? "••••••••" : value;

  return (
    // While editing, take the full row of the 2-column details grid so wide controls
    // (date + time, long text) are not squeezed into half the width on phones.
    <div className={cn("min-w-0", editable && isEditing && "col-span-full", className)} data-edit-field={fieldKey}>
      <dt className="text-xs font-medium text-muted-foreground">
        <span className="min-w-0">{label}</span>
      </dt>
      <dd className="mt-1">
        {editable && isEditing ? (
          <InlineEditor
            key={fieldKey}
            label={label}
            kind={kind}
            options={options}
            required={required}
            mono={mono}
            initial={toDraft(kind, editValue)}
            saving={saving}
            externalError={errorMessage}
            onCancel={onCancel}
            onSave={onSave}
            onDirtyChange={onDirtyChange}
          />
        ) : editable ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onRequestEdit}
              aria-label={t("orders.detail.editField", { field: label })}
              data-testid={`inline-field-${fieldKey}`}
              className={cn(
                "-mx-1.5 min-w-0 flex-1 cursor-text rounded-md px-1.5 py-0.5 text-left outline-none transition-colors",
                "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/35",
                valueClassName,
              )}
            >
              {empty ? (
                <span className="font-normal text-muted-foreground">{emptyPlaceholder ?? t("orders.detail.inlineEmpty")}</span>
              ) : (
                <span className="whitespace-pre-wrap">{shown}</span>
              )}
            </button>
            {masked && !empty ? <RevealToggle revealed={revealed} onToggle={() => setRevealed((current) => !current)} /> : null}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className={cn("min-w-0 whitespace-pre-wrap", valueClassName)}>{shown}</span>
            {masked && !empty ? <RevealToggle revealed={revealed} onToggle={() => setRevealed((current) => !current)} /> : null}
          </div>
        )}
      </dd>
    </div>
  );
}

function RevealToggle({ revealed, onToggle }: { revealed: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={revealed ? t("orders.industryFields.hidePasscode") : t("orders.industryFields.showPasscode")}
      aria-pressed={revealed}
      onClick={onToggle}
    >
      {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
    </Button>
  );
}

type InlineEditorProps = {
  label: string;
  kind: OrderInlineFieldKind;
  options: OrderInlineFieldOption[];
  required: boolean;
  mono: boolean;
  initial: OrderInlineFieldValue;
  saving: boolean;
  externalError: string | null;
  onCancel: () => void;
  onSave: (next: OrderInlineFieldValue) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
};

function InlineEditor({
  label,
  kind,
  options,
  required,
  mono,
  initial,
  saving,
  externalError,
  onCancel,
  onSave,
  onDirtyChange,
}: InlineEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<OrderInlineFieldValue>(initial);
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectOpen, setSelectOpen] = useState(false);
  const controlRef = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLButtonElement>(null);
  const mountedRef = useRef(true);
  const onDirtyChangeRef = useRef(onDirtyChange);

  const dirty = draft !== initial;

  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const control = controlRef.current;
    if (!control) return;
    control.focus({ preventScroll: true });
    if (kind === "text" || kind === "textarea" || kind === "number") control.select?.();
    // Focus once when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  useEffect(() => {
    return () => onDirtyChangeRef.current?.(false);
  }, []);

  function isEmptyDraft(next: OrderInlineFieldValue) {
    return kind === "checkbox" ? next !== true : String(next).trim() === "";
  }

  async function submit() {
    if (saving) return;
    if (required && isEmptyDraft(draft)) {
      setLocalError(t("settings.orderFields.validation.required"));
      return;
    }
    if (!dirty) {
      onCancel();
      return;
    }
    setLocalError(null);
    try {
      await onSave(draft);
    } catch (error) {
      if (!mountedRef.current) return;
      setLocalError(error instanceof Error && error.message ? error.message : t("common.somethingWentWrong"));
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      if (selectOpen) return; // Let Radix close the dropdown first.
      event.preventDefault();
      event.stopPropagation();
      if (!saving) onCancel();
      return;
    }
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (kind === "textarea") {
      if (!(event.ctrlKey || event.metaKey)) return;
    } else if (kind === "select" || kind === "checkbox") {
      return;
    } else if (event.shiftKey) {
      return;
    }
    event.preventDefault();
    void submit();
  }

  function updateDraft(next: OrderInlineFieldValue) {
    setDraft(next);
    if (localError) setLocalError(null);
  }

  const error = localError ?? externalError;
  const errorId = `inline-error-${label.replace(/\s+/g, "-")}`;
  const common = {
    "aria-label": label,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
    disabled: saving,
  } as const;

  return (
    <div className="space-y-2" onKeyDown={handleKeyDown} data-testid="order-inline-editor">
      {kind === "textarea" ? (
        <Textarea
          {...common}
          ref={controlRef}
          rows={3}
          value={String(draft)}
          onChange={(event) => updateDraft(event.target.value)}
        />
      ) : kind === "select" ? (
        <Select
          value={draft === "" ? NONE_OPTION : String(draft)}
          onValueChange={(next) => updateDraft(next === NONE_OPTION ? "" : next)}
          open={selectOpen}
          onOpenChange={setSelectOpen}
          disabled={saving}
        >
          <SelectTrigger {...common} ref={controlRef} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {!required ? <SelectItem value={NONE_OPTION}>{t("common.noValue")}</SelectItem> : null}
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : kind === "checkbox" ? (
        <input
          {...common}
          ref={controlRef}
          type="checkbox"
          className="size-4 cursor-pointer accent-primary"
          checked={draft === true}
          onChange={(event) => updateDraft(event.target.checked)}
        />
      ) : (
        <Input
          {...common}
          ref={controlRef}
          type={kind === "number" ? "number" : kind}
          step={kind === "number" ? "any" : undefined}
          inputMode={kind === "number" ? "decimal" : undefined}
          className={mono ? "font-mono" : undefined}
          value={String(draft)}
          onChange={(event) => updateDraft(event.target.value)}
        />
      )}

      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive [overflow-wrap:anywhere]">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" loading={saving} onClick={() => void submit()}>
          {saving ? t("common.saving") : t("common.save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
