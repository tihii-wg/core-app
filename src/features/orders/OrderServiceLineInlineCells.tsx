import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { OrderService } from "../../lib/types";
import { formatQuantity, parseQuantity } from "../../lib/quantity";
import { cn } from "../../lib/utils";
import type { AssignableTechnician } from "./assignableTechnicians";
import OrderLinePerformersPicker from "./OrderLinePerformersPicker";
import { linePerformerIds, linePerformerNames } from "./linePerformers";
import { OrderLineInlineNumberEditor as InlineNumberEditor } from "./OrderLineInlineNumberEditor";
import { parseOrderServiceLinePrice } from "./updateOrderServiceLine";

export type ServiceLineInlineField = "price" | "quantity" | "performer";

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

/**
 * Click-to-edit price / performer cells for one order service line.
 * Quantity and price are click-to-edit; the performer is edited under the service name.
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
            selectOnFocus
            parse={(raw) => {
              const parsed = parseQuantity(raw);
              if (parsed === "required") return t("orders.validation.quantityRequired");
              if (parsed === "min") return t("orders.validation.quantityMin");
              if (parsed === "maxDecimals") return t("orders.validation.quantityMaxDecimals");
              if (typeof parsed !== "number") return t("orders.validation.quantityMin");
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

/** Performer(s) control rendered under the service name (not a table column). */
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
  /** Receives all performer ids joined with "," — first = main performer. */
  onSaveField: (performerIds: string) => Promise<void>;
  onEditorClosed: () => void;
}) {
  const { t } = useTranslation();
  const canEditLine = editable && Boolean(line.id?.trim());
  const isEditing = Boolean(canEditLine && editing && editing.lineId === line.id && editing.field === "performer");
  const names = linePerformerNames(line);
  const label = names.length > 1 ? t("orders.team.performers") : t("orders.team.performer");

  if (isEditing) {
    return (
      <InlinePerformersEditor
        line={line}
        options={performerOptions}
        saving={saving}
        testId={`service-line-performer-editor-${line.id}`}
        // Each add / remove is saved right away, but the editor stays open so several performers can be
        // picked in a row; «Готово» (or Esc) closes it.
        onSave={async (ids) => {
          await onSaveField(ids.join(","));
        }}
        onDone={(changed) => {
          if (changed) onSaved();
          else onCancel();
          onEditorClosed();
        }}
      />
    );
  }

  if (!canEditLine) {
    if (names.length === 0) return null;
    return (
      <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {label}: {names.join(", ")}
      </p>
    );
  }

  return (
    <button
      type="button"
      data-testid={`service-line-performer-${line.id ?? "legacy"}`}
      aria-label={t("orders.detail.editField", { field: t("orders.team.performers") })}
      className={cn(
        "-mx-1 rounded-md px-1 py-0.5 text-left text-xs outline-none transition-colors",
        "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/35",
        names.length ? "text-muted-foreground [overflow-wrap:anywhere]" : "font-normal text-muted-foreground/80",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onRequestEdit();
      }}
    >
      {names.length ? (
        <>
          {label}: {names.join(", ")}
        </>
      ) : (
        t("orders.detail.addPerformer")
      )}
    </button>
  );
}

/** Editor for all performers of a line: every add / remove is saved right away; «Готово» closes it. */
function InlinePerformersEditor({
  line,
  options,
  saving,
  testId,
  onSave,
  onDone,
}: {
  line: OrderService;
  options: AssignableTechnician[];
  saving: boolean;
  testId: string;
  onSave: (ids: string[]) => Promise<void>;
  onDone: (changed: boolean) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string[]>(() => linePerformerIds(line));
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const knownNames: Record<string, string> = {};
  if (line.technicianId && line.technicianName) knownNames[line.technicianId] = line.technicianName;
  (line.extraTechnicianIds ?? []).forEach((id, index) => {
    const name = line.extraTechnicianNames?.[index];
    if (name) knownNames[id] = name;
  });

  async function change(next: string[]) {
    const previous = draft;
    setDraft(next);
    setError(null);
    setBusy(true);
    try {
      await onSave(next);
      setChanged(true);
    } catch (err) {
      setDraft(previous);
      setError(err instanceof Error && err.message ? err.message : t("common.somethingWentWrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mt-0.5 space-y-1.5"
      data-testid={testId}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onDone(changed);
        }
      }}
    >
      <OrderLinePerformersPicker
        idPrefix={testId}
        value={draft}
        options={options}
        knownNames={knownNames}
        saving={saving || busy}
        onChange={(next) => void change(next)}
      />
      <button
        type="button"
        className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-muted disabled:opacity-50"
        disabled={busy}
        onClick={() => onDone(changed)}
      >
        {t("orders.team.done")}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-destructive [overflow-wrap:anywhere]">
          {error}
        </p>
      ) : null}
    </div>
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

