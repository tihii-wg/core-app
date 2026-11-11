import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { Input } from "../../ui/Input";

type OrderLineInlineNumberEditorProps = {
  label: string;
  initial: string;
  testId: string;
  saving: boolean;
  selectOnFocus?: boolean;
  parse: (raw: string) => string | { value: string };
  onCancel: () => void;
  onSave: (raw: string) => Promise<void>;
  onAfterSave?: (viaTab: boolean) => void;
  /** Fires on every keystroke so parents can show live warnings (e.g. below-cost). */
  onDraftChange?: (raw: string) => void;
  /** Optional content under the input (warnings stay visible while typing). */
  footer?: ReactNode;
};

/**
 * Shared click-to-edit number control for order line cells (service price, material qty/price).
 * Enter / blur saves; Esc cancels; errors render under the control.
 */
export function OrderLineInlineNumberEditor({
  label,
  initial,
  testId,
  saving,
  selectOnFocus = false,
  parse,
  onCancel,
  onSave,
  onAfterSave,
  onDraftChange,
  footer,
}: OrderLineInlineNumberEditorProps) {
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
        className={cn("h-9 w-full min-w-[3.75rem] text-base tabular-nums md:min-w-[4.5rem] md:text-sm", error && "border-destructive")}
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          onDraftChange?.(next);
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
      {footer}
      {error ? (
        <p role="alert" className="text-left text-xs text-destructive [overflow-wrap:anywhere]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
