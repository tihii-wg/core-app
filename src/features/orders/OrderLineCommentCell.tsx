import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/Button";
import { Textarea } from "../../ui/Textarea";
import { ORDER_LINE_COMMENT_MAX, normalizeOrderLineCommentBody } from "./orderLineComments";

type OrderLineCommentCellProps = {
  comment: string | null | undefined;
  /** When false, hide the whole cell (feature off / not visible to user). */
  visible: boolean;
  /** When false, show text only (no add/edit). */
  editable: boolean;
  saving?: boolean;
  onSave: (next: string | null) => Promise<void>;
};

/**
 * Inline per-line comment under the line name.
 * Desktop: add link on hover/focus-within; touch: always show the add affordance.
 */
export function OrderLineCommentCell({
  comment,
  visible,
  editable,
  saving = false,
  onSave,
}: OrderLineCommentCellProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const skipBlurSave = useRef(false);

  const text = comment?.trim() || "";

  useEffect(() => {
    if (!editing) setDraft(comment ?? "");
  }, [comment, editing]);

  useEffect(() => {
    if (!editing) return;
    const node = textareaRef.current;
    if (!node) return;
    node.focus();
    const len = node.value.length;
    node.setSelectionRange(len, len);
  }, [editing]);

  if (!visible) return null;
  if (!editable && !text) return null;

  async function commit(raw: string) {
    const next = normalizeOrderLineCommentBody(raw);
    const prev = text || null;
    if (next === prev) {
      setEditing(false);
      setLocalError(null);
      return;
    }
    if (next && next.length > ORDER_LINE_COMMENT_MAX) {
      setLocalError(t("orders.lineComments.errors.tooLong"));
      return;
    }
    try {
      await onSave(next);
      setEditing(false);
      setLocalError(null);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t("common.somethingWentWrong"));
    }
  }

  function cancel() {
    skipBlurSave.current = true;
    setDraft(comment ?? "");
    setLocalError(null);
    setEditing(false);
  }

  if (editing) {
    const remaining = ORDER_LINE_COMMENT_MAX - draft.length;
    return (
      <div className="mt-1 w-full max-w-full space-y-1" data-testid="order-line-comment-editor">
        <Textarea
          ref={textareaRef}
          value={draft}
          disabled={saving}
          rows={2}
          maxLength={ORDER_LINE_COMMENT_MAX}
          placeholder={t("orders.lineComments.placeholder")}
          className="min-h-[2.5rem] text-sm"
          onChange={(event) => {
            setDraft(event.target.value);
            setLocalError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
              return;
            }
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              skipBlurSave.current = true;
              void commit(draft);
            }
          }}
          onBlur={() => {
            if (skipBlurSave.current) {
              skipBlurSave.current = false;
              return;
            }
            void commit(draft);
          }}
        />
        <div className="flex items-center justify-between gap-2">
          {localError ? (
            <p className="text-xs text-destructive" role="alert">
              {localError}
            </p>
          ) : (
            <span className={cn("text-[11px] text-muted-foreground", remaining <= 40 && "text-amber-700 dark:text-amber-400")}>
              {remaining <= 40 ? t("orders.lineComments.charsLeft", { count: remaining }) : null}
            </span>
          )}
          <Button type="button" size="sm" variant="ghost" disabled={saving} onMouseDown={() => cancel()}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  if (text) {
    return (
      <div className="group/comment mt-0.5 flex min-w-0 items-start gap-1" data-testid="order-line-comment">
        <p
          className="min-w-0 flex-1 text-xs text-muted-foreground [overflow-wrap:anywhere] line-clamp-3"
          title={text}
        >
          {text}
        </p>
        {editable ? (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-100 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 sm:opacity-0 sm:group-hover/comment:opacity-100 sm:group-focus-within/comment:opacity-100"
            aria-label={t("orders.lineComments.edit")}
            data-testid="order-line-comment-edit"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="mt-0.5 text-left text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline focus-visible:outline-none opacity-100 sm:opacity-0 sm:group-hover/line:opacity-100 sm:group-focus-within/line:opacity-100"
      data-testid="order-line-comment-add"
      onClick={() => setEditing(true)}
    >
      {t("orders.lineComments.add")}
    </button>
  );
}
