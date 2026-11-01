import i18n from "../i18n";
import supabase from "./supabase";
import { isMissingTableError, requireWorkspaceId } from "./missingTable";
import type { NotificationChannel } from "./apiNotificationRules";

/**
 * Stage 5 DRY-RUN dispatch. This module NEVER calls an SMS / email / Telegram / WhatsApp provider.
 * It only writes a row to `message_log` so the owner can see what a rule would have sent.
 *
 * `message_log.status` is constrained to queued|delayed|sent|delivered|failed|skipped, so a dry-run row is stored as
 * `skipped` (never `queued`: a future dispatcher must not pick it up) and is marked by `provider = 'dry_run'`.
 */
export const DRY_RUN_PROVIDER = "dry_run";
export const DRY_RUN_STATUS = "skipped";

export type DryRunNotifyInput = {
  workspaceId: string | undefined;
  ruleId?: string | null;
  channel: NotificationChannel;
  recipient: string;
  body: string;
  /** `order` fills `message_log.order_id`, `client` fills `client_id`; other entity types have no column and are ignored. */
  entityType?: string | null;
  entityId?: string | null;
};

export type DryRunNotifyResult =
  | { sent: false; reason: "dry_run"; logId: string | null }
  | { sent: false; reason: "unavailable" }
  /** Table exists but RLS does not allow this user to insert into `message_log` (browser inserts are closed by default). */
  | { sent: false; reason: "forbidden" };

const channels: readonly NotificationChannel[] = ["sms", "email", "telegram", "whatsapp", "in_app"];

export function buildDryRunLogRow(input: Omit<DryRunNotifyInput, "workspaceId"> & { workspaceId: string }) {
  const channel = input.channel;
  if (!channels.includes(channel)) throw new Error(i18n.t("settings.notificationRules.dryRun.errors.channel"));
  const recipient = input.recipient.trim();
  const body = input.body.trim();
  if (!recipient || !body) throw new Error(i18n.t("settings.notificationRules.dryRun.errors.required"));

  const entityId = input.entityId?.trim() || null;
  return {
    workspace_id: input.workspaceId,
    channel,
    direction: "outbound" as const,
    status: DRY_RUN_STATUS,
    recipient,
    body,
    rule_id: input.ruleId?.trim() || null,
    order_id: input.entityType === "order" ? entityId : null,
    client_id: input.entityType === "client" ? entityId : null,
    provider: DRY_RUN_PROVIDER,
    error: null,
    sent_at: null,
  };
}

/**
 * Writes one dry-run row to `message_log`. Never sends anything.
 * Returns `{ sent: false, reason: 'unavailable' }` when `message_log` is not applied in this database.
 */
export async function dryRunNotify(input: DryRunNotifyInput): Promise<DryRunNotifyResult> {
  const workspaceId = requireWorkspaceId(input.workspaceId);
  const row = buildDryRunLogRow({ ...input, workspaceId });

  const { data, error } = await supabase.from("message_log").insert(row).select("id").maybeSingle();
  if (error) {
    if (isMissingTableError(error, "message_log")) return { sent: false, reason: "unavailable" };
    if (error.code === "42501") return { sent: false, reason: "forbidden" };
    throw new Error(error.message);
  }
  return { sent: false, reason: "dry_run", logId: data ? String((data as { id: unknown }).id) : null };
}
