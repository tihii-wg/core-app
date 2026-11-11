import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { OrderService } from "../../lib/types";
import { formatQuantity, parseQuantity } from "../../lib/quantity";
import { cn } from "../../lib/utils";
import { Input } from "../../ui/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import type { AssignableTechnician } from "./assignableTechnicians";
import { parseOrderServiceLinePrice } from "./updateOrderServiceLine";

export type ServiceLineInlineField = "quantity" | "price" | "performer";

export type ServiceLineInlineEditTarget = {
  lineId: string;
  field: ServiceLineInlineField;
};

type OrderServiceLineInlineCellsProps = {
  line: OrderService;
  editable: boolean;
  editing: ServiceLineInlineEditTarget | null;
  formatMoney: (value: number) => string;
  locale: string;
  amountNode: ReactNode;
  saving: boolean;
  onRequestEdit: (field: ServiceLineInlineField) => void;
  onCancel: () => void;
  onSaved: () => void;
  onSaveField: (field: ServiceLineInlineField, value: string) => Promise<void>;
  /** After price save via Tab — open performer on the same row. */
  onTabFromPrice: () => void;
  /** Called when Esc / blur-cancel finishes so the parent can restore search focus. */
  onEditorClosed: () => void;
};

const NONE_VALUE = "__service_line_none__";

/**
 * Click-to-edit quantity / price / performer cells for one order service line.
 * Enter or blur saves; Esc cancels; errors render under the control (no toast).
 */
export default function OrderServiceLineInlineCells({
  line,
  editable,
  editing,
  formatMoney,
  locale,
  amountNode,
  saving,
  onRequestEdit,
  onCancel,
  onSaved,
  onSaveField,
  onTabFromPrice,
  onEditorClosed,
}: OrderServiceLineInlineCellsProps) {
  const { t } = useTranslation();
  const canEditLine = editable && Boolean(line.id?.trim());
  const isEditing = (field: ServiceLineInlineField) =>
    Boolean(canEditLine && editing && editing.lineId === line.id && editing.field === field);

  return (
    <>
      <td className="px-2 py-2 align-top text-right tabular-nums text-muted-foreground sm:px-3">
        {isEditing("quantity") ? (
          <InlineNumberEditor
            label={t("orders.detail.quantity")}
            initial={String(line.quantity ?? "")}
            testId={`service-line-qty-editor-${line.id}`}
            saving={saving}
            parse={(raw) => {
              const parsed = parseQuantity(raw);
              if (parsed === "required") return t("orders.validation.quantityRequired");
              if (parsed === "min") return t("orders.validation.quantityMin");
              if (parsed === "maxDecimals") return t("orders.validation.quantityMaxDecimals");
              return { value: String(parsed) };
            }}
            onCancel={() => {
              onCancel();
              onEditorClosed();
            }}
            onSave={async (raw) => {
              await onSaveField("quantity", raw);
              onSaved();
            }}
            onAfterSave={() => onEditorClosed()}
          />
        ) : (
          <InlineValueButton
            editable={canEditLine}
            label={t("orders.detail.quantity")}
            testId={`service-line-qty-${line.id ?? "legacy"}`}
            onClick={() => onRequestEdit("quantity")}
            className="w-full text-right"
          >
            {formatQuantity(line.quantity, locale)}
          </InlineValueButton>
        )}
      </td>
      <td className="px-2 py-2 align-top text-right tabular-nums text-muted-foreground sm:px-3">
        {isEditing("price") ? (
          <InlineNumberEditor
            label={t("orders.detail.price")}
            initial={String(line.price ?? "")}
            testId={`service-line-price-editor-${line.id}`}
            saving={saving}
            selectOnFocus
            parse={(raw) => {
              const parsed = parseOrderServiceLinePrice(raw);
              if (parsed === "invalid") return t("orders.form.freeformPriceInvalid");
              return { value: String(parsed) };
            }}
            onCancel={() => {
              onCancel();
              onEditorClosed();
            }}
            onSave={async (raw) => {
              await onSaveField("price", raw);
              onSaved();
            }}
            onAfterSave={(viaTab) => {
              if (viaTab) onTabFromPrice();
              else onEditorClosed();
            }}
          />
        ) : (
          <InlineValueButton
            editable={canEditLine}
            label={t("orders.detail.price")}
            testId={`service-line-price-${line.id ?? "legacy"}`}
            onClick={() => onRequestEdit("price")}
            className="w-full text-right"
          >
            {formatMoney(line.price)}
          </InlineValueButton>
        )}
      </td>
      <td className="px-2 py-2 align-top text-right tabular-nums text-foreground sm:px-3">{amountNode}</td>
    </>
  );
}

/** Performer control rendered under the service name (not a table column). */
export function OrderServiceLinePerformerInline({
  line,
  editable,
  editing,
  performerOptions,
  saving,
  onRequestEdit,
  onCancel,
  onSaved,
  onSaveField,
  onEditorClosed,
}: {
  line: OrderService;
  editable: boolean;
  editing: ServiceLineInlineEditTarget | null;
  performerOptions: AssignableTechnician[];
  saving: boolean;
  onRequestEdit: () => void;
  onCancel: () => void;
  onSaved: () => void;
  onSaveField: (technicianId: string) => Promise<void>;
  onEditorClosed: () => void;
}) {
  const { t } = useTranslation();
  const canEditLine = editable && Boolean(line.id?.trim());
  const isEditing = Boolean(canEditLine && editing && editing.lineId === line.id && editing.field === "performer");
  const name = line.technicianName?.trim() ?? "";

  if (isEditing) {
    return (
      <InlinePerformerEditor
        label={t("orders.team.performer")}
        initial={line.technicianId ?? ""}
        options={performerOptions}
        saving={saving}
        testId={`service-line-performer-editor-${line.id}`}
        onCancel={() => {
          onCancel();
          onEditorClosed();
        }}
        onSave={async (technicianId) => {
          await onSaveField(technicianId);
          onSaved();
          onEditorClosed();
        }}
      />
    );
  }

  if (!canEditLine) {
    if (!name) return null;
    return (
      <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {t("orders.team.performer")}: {name}
      </p>
    );
  }

  return (
    <button
      type="button"
      data-testid={`service-line-performer-${line.id ?? "legacy"}`}
      aria-label={t("orders.detail.editField", { field: t("orders.team.performer") })}
      className={cn(
        "-mx-1 rounded-md px-1 py-0.5 text-left text-xs outline-none transition-colors",
        "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/35",
        name ? "text-muted-foreground [overflow-wrap:anywhere]" : "font-normal text-muted-foreground/80",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onRequestEdit();
      }}
    >
      {name ? (
        <>
          {t("orders.team.performer")}: {name}
        </>
      ) : (
        t("orders.detail.addPerformer")
      )}
    </button>
  );
}

function InlineValueButton({
  editable,
  label,
  testId,
  onClick,
  className,
  children,
}: {
  editable: boolean;
  label: string;
  testId: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (!editable) {
    return <span className={cn("block min-w-0 [overflow-wrap:anywhere]", className)}>{children}</span>;
  }
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={t("orders.detail.editField", { field: label })}
      className={cn(
        "-mx-1 min-w-0 cursor-text rounded-md px-1 py-0.5 outline-none transition-colors",
        "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/35",
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function InlineNumberEditor({
  label,
  initial,
  testId,
  saving,
  selectOnFocus = false,
  parse,
  onCancel,
  onSave,
  onAfterSave,
}: {
  label: string;
  initial: string;
  testId: string;
  saving: boolean;
  selectOnFocus?: boolean;
  parse: (raw: string) => string | { value: string };
  onCancel: () => void;
  onSave: (raw: string) => Promise<void>;
  onAfterSave?: (viaTab: boolean) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurSaveRef = useRef(false);
  const mountedRef = useRef(true);
  const supportsTab = Boolean(onAfterSave);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    if (selectOnFocus) input.select();
  }, [selectOnFocus]);

  async function submit(viaTab = false): Promise<boolean> {
    if (saving) return false;
    const result = parse(draft);
    if (typeof result === "string") {
      setError(result);
      return false;
    }
    if (result.value === initial) {
      if (viaTab) onAfterSave?.(true);
      else onCancel();
      return true;
    }
    setError(null);
    try {
      await onSave(result.value);
      onAfterSave?.(viaTab);
      return true;
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error && err.message ? err.message : t("common.somethingWentWrong"));
      }
      return false;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      skipBlurSaveRef.current = true;
      onCancel();
      return;
    }
    if (event.key === "Tab" && supportsTab && !event.shiftKey) {
      event.preventDefault();
      skipBlurSaveRef.current = true;
      void submit(true);
      return;
    }
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      skipBlurSaveRef.current = true;
      void submit(false);
    }
  }

  return (
    <div className="space-y-1" data-testid={testId} onClick={(event) => event.stopPropagation()}>
      <Input
        ref={inputRef}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        disabled={saving}
        inputMode="decimal"
        className={cn("h-9 w-full min-w-[4.5rem] text-base tabular-nums md:text-sm", error && "border-destructive")}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (skipBlurSaveRef.current) {
            skipBlurSaveRef.current = false;
            return;
          }
          void submit(false);
        }}
      />
      {error ? (
        <p role="alert" className="text-left text-xs text-destructive [overflow-wrap:anywhere]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function InlinePerformerEditor({
  label,
  initial,
  options,
  saving,
  testId,
  onCancel,
  onSave,
}: {
  label: string;
  initial: string;
  options: AssignableTechnician[];
  saving: boolean;
  testId: string;
  onCancel: () => void;
  onSave: (technicianId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const skipBlurRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    setPortalContainer(rootRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null);
  }, []);

  async function submit(next: string) {
    if (saving) return;
    if (next === initial) {
      onCancel();
      return;
    }
    setError(null);
    try {
      await onSave(next);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error && err.message ? err.message : t("common.somethingWentWrong"));
      }
    }
  }

  return (
    <div
      ref={rootRef}
      className="mt-0.5 space-y-1"
      data-testid={testId}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          if (open) return;
          event.preventDefault();
          event.stopPropagation();
          skipBlurRef.current = true;
          onCancel();
        }
      }}
    >
      <Select
        value={draft || NONE_VALUE}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && !skipBlurRef.current && !saving && !error) {
            // Closing the list without a change cancels; a change already called submit.
            if (draft === initial) onCancel();
          }
        }}
        onValueChange={(next) => {
          const value = next === NONE_VALUE ? "" : next;
          setDraft(value);
          skipBlurRef.current = true;
          void submit(value);
        }}
        disabled={saving}
      >
        <SelectTrigger aria-label={label} className="h-9 w-full max-w-full text-base md:text-sm">
          <SelectValue placeholder={t("orders.team.notAssigned")} />
        </SelectTrigger>
        <SelectContent container={portalContainer} position="popper" className="z-[80]">
          <SelectItem value={NONE_VALUE}>{t("orders.team.notAssigned")}</SelectItem>
          {options.map((technician) => (
            <SelectItem key={technician.id} value={technician.id}>
              {technician.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <p role="alert" className="text-xs text-destructive [overflow-wrap:anywhere]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
