import { useEffect, useRef, useState } from "react";
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
  /** Editor open state, controlled by the row (its comment button next to the pencil opens it). */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onSave: (next: string | null) => Promise<void>;
};

/**
 * Inline per-line comment under the line name: the text (click to edit) or the editor. Opening it is the
 * row's always-visible comment button next to the pencil.
 */
export function OrderLineCommentCell({
  comment,
  visible,
  editable,
  saving = false,
  editing,
  onEditingChange: setEditing,
  onSave,
}: OrderLineCommentCellProps) {
  const { t } = useTranslation();
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

  if (!text) return null;
  return (
    <p
      className={cn(
        "mt-0.5 min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere] line-clamp-3",
        editable && "cursor-text hover:text-foreground",
      )}
      title={text}
      data-testid="order-line-comment"
      onClick={editable ? () => setEditing(true) : undefined}
    >
      {text}
    </p>
  );
}
