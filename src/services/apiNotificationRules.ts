import supabase from "./supabase";
import { isMissingTableError, requireWorkspaceId } from "./missingTable";

export type NotificationChannel = "sms" | "email" | "telegram" | "whatsapp" | "in_app";

export type NotificationRule = {
  id: string;
  workspaceId: string;
  audience: "client" | "staff";
  entity: string;
  event: string;
  channel: NotificationChannel;
  templateId: string | null;
  templateName: string | null;
  delayMinutes: number;
  isActive: boolean;
};

const ruleColumns = "id, workspace_id, audience, entity, event, channel, template_id, delay_minutes, is_active";

const channels: readonly NotificationChannel[] = ["sms", "email", "telegram", "whatsapp", "in_app"];

export function toNotificationRule(row: Record<string, unknown>, templateNames: Map<string, string>): NotificationRule {
  const channel = row.channel as NotificationChannel;
  const templateId = typeof row.template_id === "string" ? row.template_id : null;
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    audience: row.audience === "staff" ? "staff" : "client",
    entity: typeof row.entity === "string" ? row.entity : "",
    event: typeof row.event === "string" ? row.event : "",
    channel: channels.includes(channel) ? channel : "in_app",
    templateId,
    templateName: templateId ? (templateNames.get(templateId) ?? null) : null,
    delayMinutes: Number.isFinite(Number(row.delay_minutes)) ? Number(row.delay_minutes) : 0,
    isActive: row.is_active !== false,
  };
}

async function getTemplateNames(workspaceId: string) {
  const { data, error } = await supabase
    .from("message_templates")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  if (error) {
    if (isMissingTableError(error, "message_templates")) return new Map<string, string>();
    throw new Error(error.message);
  }
  return new Map(((data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
}

/** Returns [] when `notification_rules` is not applied yet; template names resolve best-effort. */
export async function getNotificationRules(workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("notification_rules")
    .select(ruleColumns)
    .eq("workspace_id", resolved)
    .order("audience", { ascending: true })
    .order("entity", { ascending: true })
    .order("event", { ascending: true });

  if (error) {
    if (isMissingTableError(error, "notification_rules")) return [] as NotificationRule[];
    throw new Error(error.message);
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [] as NotificationRule[];
  const templateNames = await getTemplateNames(resolved);
  return rows.map((row) => toNotificationRule(row, templateNames));
}
