import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Trash2 } from "lucide-react";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { Textarea } from "../../ui/Textarea";
import { ORDER_COMMENT_MAX_LENGTH } from "../../services/apiOrderComments";
import { industryOrderStatusLabel, ORDER_STATUSES } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import {
  describeOrderEvent,
  orderEventCategory,
  type OrderEventCategory,
  type OrderEventDescription,
} from "./orderFeed";
import { useCreateOrderComment, useDeleteOrderComment, useGetOrderComments, useGetOrderEvents } from "./useOrderFeed";
import type { OrderStatus } from "../../lib/types";

const categoryDotClass: Record<OrderEventCategory, string> = {
  lifecycle: "bg-foreground/70",
  status: "bg-primary/70",
  payment: "bg-emerald-600",
  refund: "bg-amber-600",
  service: "bg-sky-600",
  inventory: "bg-violet-600",
  field: "bg-slate-500",
  warranty: "bg-teal-600",
  other: "bg-muted-foreground/60",
};

type OrderFeedSectionProps = {
  orderId: string;
  /** Nothing is fetched while the panel is closed. */
  enabled: boolean;
  /** False when the subscription is read-only or the user cannot edit orders. */
  canComment: boolean;
};

function eventText(t: TFunction, description: OrderEventDescription) {
  // Dynamic event keys stay stringly-typed so new activity events do not require regenerating i18n types.
  const key = `orders.feed.events.${description.key}`;
  const text = String(t(key as never, description.params as never));
  return description.key === "generic" ? text.replace(/\s{2,}/g, " ") : text;
}

function formatStamp(value: string, locale: string) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/** Order detail: comments (add/delete) and the activity event timeline. Degrades to notices when tables/RPC are missing. */
export default function OrderFeedSection({ orderId, enabled, canComment }: OrderFeedSectionProps) {
  const { t, i18n } = useTranslation();
  const { workflow } = useIndustryWorkflow();
  const locale = i18n.language || "en";
  const comments = useGetOrderComments(orderId, enabled);
  const events = useGetOrderEvents(orderId, enabled);
  const createComment = useCreateOrderComment(orderId);
  const deleteComment = useDeleteOrderComment(orderId);
  const [draft, setDraft] = useState("");

  const statusLabel = (value: string) =>
    (ORDER_STATUSES as readonly string[]).includes(value) ? industryOrderStatusLabel(workflow, value as OrderStatus) : value;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || createComment.isPending) return;
    createComment.mutate(draft, { onSuccess: () => setDraft("") });
  }

  return (
    <div className="space-y-5 border-t border-border pt-5" data-testid="order-feed">
      <section aria-label={t("orders.feed.commentsTitle")} className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">{t("orders.feed.commentsTitle")}</h3>

        {comments.isUnavailable || comments.isError ? (
          <Notice title={t("orders.feed.unavailable")} hint={t("orders.feed.unavailableHint")} />
        ) : (
          <>
            {canComment ? (
              <form onSubmit={handleSubmit} className="space-y-2" aria-label={t("orders.feed.addComment")}>
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t("orders.feed.commentPlaceholder")}
                  aria-label={t("orders.feed.commentLabel")}
                  maxLength={ORDER_COMMENT_MAX_LENGTH}
                  rows={2}
                  disabled={createComment.isPending}
                />
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={!draft.trim() || createComment.isPending}>
                    {createComment.isPending ? t("common.saving") : t("orders.feed.addComment")}
                  </Button>
                </div>
              </form>
            ) : null}

            {comments.isLoading ? (
              <Skeleton className="h-14 w-full" />
            ) : comments.comments.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-4 py-4 text-center text-[13px] text-muted-foreground">
                {t("orders.feed.noComments")}
              </p>
            ) : (
              <ul className="space-y-2">
                {comments.comments.map((comment) => (
                  <li key={comment.id} className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{comment.authorName ?? t("orders.feed.unknownAuthor")}</span>
                        {" · "}
                        <time dateTime={comment.createdAt} className="tabular-nums">
                          {formatStamp(comment.createdAt, locale)}
                        </time>
                      </p>
                      {canComment ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="-my-1 -mr-1.5 shrink-0"
                          aria-label={t("orders.feed.deleteComment")}
                          disabled={deleteComment.isPending}
                          onClick={() => deleteComment.mutate(comment.id)}
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere] text-foreground">{comment.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section aria-label={t("orders.feed.historyTitle")} className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">{t("orders.feed.historyTitle")}</h3>

        {events.isUnavailable || events.isError ? (
          <Notice title={t("orders.feed.unavailable")} hint={t("orders.feed.eventsUnavailableHint")} />
        ) : events.isLoading ? (
          <Skeleton className="h-14 w-full" />
        ) : events.events.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-4 text-center text-[13px] text-muted-foreground">
            {t("orders.feed.noEvents")}
          </p>
        ) : (
          <ol className="space-y-3 border-l border-border pl-4">
            {events.events.map((event) => {
              const description = describeOrderEvent(event, statusLabel);
              const category = orderEventCategory(event);
              return (
                <li key={event.id} className="relative min-w-0" data-event-category={category} data-event-type={event.eventType}>
                  <span
                    aria-hidden="true"
                    className={`absolute top-1.5 -left-[1.3125rem] size-2 rounded-full ${categoryDotClass[category]}`}
                  />
                  <p className="text-sm [overflow-wrap:anywhere] text-foreground">{eventText(t, description)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {event.actorName ?? t("orders.feed.unknownAuthor")}
                    {" · "}
                    <time dateTime={event.createdAt} className="tabular-nums">
                      {formatStamp(event.createdAt, locale)}
                    </time>
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

function Notice({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-4 text-center">
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
