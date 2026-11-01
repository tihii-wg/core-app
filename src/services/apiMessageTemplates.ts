import { isMissingTableError, requireWorkspaceId } from "./missingTable";
import supabase from "./supabase";
import type { NotificationChannel } from "./apiNotificationRules";

/** Message templates live in `message_templates` (crm_ro_v1, section 9). */
export type MessageTemplate = {
  id: string;
  workspaceId: string;
  name: string;
  channel: NotificationChannel;
  subject: string | null;
  body: string;
  isActive: boolean;
};

export type MessageTemplatesResult = {
  templates: MessageTemplate[];
  /** True when `message_templates` is not applied in this database yet. */
  isUnavailable: boolean;
};

const templateColumns = "id, workspace_id, name, channel, subject, body, is_active, deleted_at";
const channels: readonly NotificationChannel[] = ["sms", "email", "telegram", "whatsapp", "in_app"];

export function toMessageTemplate(row: Record<string, unknown>): MessageTemplate {
  const channel = row.channel as NotificationChannel;
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: typeof row.name === "string" ? row.name : "",
    channel: channels.includes(channel) ? channel : "in_app",
    subject: typeof row.subject === "string" && row.subject.trim() ? row.subject : null,
    body: typeof row.body === "string" ? row.body : "",
    isActive: row.is_active !== false,
  };
}

/** Lists message templates (read-only). A missing table resolves to `{ templates: [], isUnavailable: true }`. */
export async function getMessageTemplates(workspaceId: string | undefined): Promise<MessageTemplatesResult> {
  const resolved = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("message_templates")
    .select(templateColumns)
    .eq("workspace_id", resolved)
    .is("deleted_at", null)
    .order("channel", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    if (isMissingTableError(error, "message_templates")) return { templates: [], isUnavailable: true };
    throw new Error(error.message);
  }
  return { templates: ((data ?? []) as Record<string, unknown>[]).map(toMessageTemplate), isUnavailable: false };
}
