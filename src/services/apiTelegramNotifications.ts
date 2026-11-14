import i18n from "../i18n";
import supabase from "./supabase";

/** Events a user can subscribe to (mirrors notification_subscriptions_event_check). */
export const NOTIFICATION_EVENT_GROUPS = {
  orders: [
    "order_created",
    "estimate_created",
    "order_status_changed",
    "order_closed",
    "order_cancelled",
    "order_assigned_to_me",
  ],
  money: ["payment_received", "payment_stage_due"],
  deadlines: ["order_deadline_tomorrow", "order_overdue"],
  inventory: ["inventory_low_stock"],
} as const;

export type NotificationEventGroup = keyof typeof NOTIFICATION_EVENT_GROUPS;
export type NotificationEvent = (typeof NOTIFICATION_EVENT_GROUPS)[NotificationEventGroup][number];
export type NotificationScope = "all" | "mine";

export const NOTIFICATION_EVENTS: NotificationEvent[] = Object.values(NOTIFICATION_EVENT_GROUPS).flat() as NotificationEvent[];

/** Events where "only my orders" makes sense (assigned-to-me and stock are inherently scoped). */
export function eventSupportsScope(event: NotificationEvent): boolean {
  return event !== "order_assigned_to_me" && event !== "inventory_low_stock";
}

/** Sensible starting set offered by «Включить рекомендуемые». */
export const RECOMMENDED_EVENTS: NotificationEvent[] = [
  "order_created",
  "order_assigned_to_me",
  "payment_received",
  "order_deadline_tomorrow",
  "order_overdue",
  "inventory_low_stock",
];

export type TelegramLink = {
  username: string | null;
  firstName: string | null;
  isActive: boolean;
  linkedAt: string | null;
};

export type NotificationSubscription = { event: NotificationEvent; enabled: boolean; scope: NotificationScope };

export class TelegramNotificationsUnavailableError extends Error {
  constructor() {
    super(i18n.t("settings.telegram.errors.unavailable"));
    this.name = "TelegramNotificationsUnavailableError";
  }
}

function isMissingSchema(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === "PGRST205" ||
    error?.code === "42P01" ||
    error?.code === "PGRST202" ||
    error?.code === "42883" ||
    /does not exist|could not find/i.test(error?.message ?? "")
  );
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user?.id;
  if (!id) throw new Error(i18n.t("settings.profile.errors.notAuthenticated"));
  return id;
}

export function telegramBotUsername(): string {
  return String(import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "");
}

export async function getTelegramLink(): Promise<TelegramLink | null> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("user_telegram_links")
    .select("username, first_name, is_active, linked_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) throw new TelegramNotificationsUnavailableError();
    throw new Error(error.message);
  }
  if (!data) return null;
  return {
    username: (data.username as string | null) ?? null,
    firstName: (data.first_name as string | null) ?? null,
    isActive: data.is_active !== false,
    linkedAt: (data.linked_at as string | null) ?? null,
  };
}

/** One-time deep link that opens the bot; /start <token> links this Telegram chat to the user. */
export async function createTelegramConnectUrl(): Promise<string> {
  const bot = telegramBotUsername();
  if (!bot) throw new Error(i18n.t("settings.telegram.errors.botNotConfigured"));
  const { data, error } = await supabase.rpc("crm_telegram_link_token");
  if (error) {
    if (isMissingSchema(error)) throw new TelegramNotificationsUnavailableError();
    throw new Error(error.message);
  }
  const token = String(data ?? "").trim();
  if (!token) throw new Error(i18n.t("common.somethingWentWrong"));
  return `https://t.me/${encodeURIComponent(bot)}?start=${encodeURIComponent(token)}`;
}

export async function unlinkTelegram(): Promise<void> {
  const { error } = await supabase.rpc("crm_telegram_unlink");
  if (error) {
    if (isMissingSchema(error)) throw new TelegramNotificationsUnavailableError();
    throw new Error(error.message);
  }
}

export async function getNotificationSubscriptions(workspaceId: string | undefined): Promise<NotificationSubscription[]> {
  if (!workspaceId) return [];
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("notification_subscriptions")
    .select("event, enabled, scope")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (error) {
    if (isMissingSchema(error)) throw new TelegramNotificationsUnavailableError();
    throw new Error(error.message);
  }
  return (data ?? [])
    .filter((row) => NOTIFICATION_EVENTS.includes(row.event as NotificationEvent))
    .map((row) => ({
      event: row.event as NotificationEvent,
      enabled: row.enabled !== false,
      scope: row.scope === "mine" ? "mine" : "all",
    }));
}

export async function saveNotificationSubscriptions(
  workspaceId: string | undefined,
  changes: NotificationSubscription[],
): Promise<void> {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  if (changes.length === 0) return;
  const userId = await currentUserId();
  const rows = changes.map((change) => ({
    workspace_id: workspaceId,
    user_id: userId,
    event: change.event,
    enabled: change.enabled,
    scope: eventSupportsScope(change.event) ? change.scope : "all",
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from("notification_subscriptions")
    .upsert(rows, { onConflict: "workspace_id,user_id,event" });
  if (error) {
    if (isMissingSchema(error)) throw new TelegramNotificationsUnavailableError();
    throw new Error(error.message);
  }
}
