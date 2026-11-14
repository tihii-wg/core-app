/**
 * Telegram bot webhook: links a Telegram chat to a Core App user via /start <one-time token>.
 * Auth: header X-Telegram-Bot-Api-Secret-Token === TELEGRAM_WEBHOOK_SECRET (set via setWebhook secret_token).
 * Deploy: supabase functions deploy telegram-webhook --project-ref <ref> --no-verify-jwt
 */
import { timingSafeEqual } from "../_shared/crypto.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { botTexts, normalizeLang, readBotToken, sendTelegramMessage, type NotifyLang } from "../_shared/telegram.ts";

type TgUser = { id: number; username?: string; first_name?: string; language_code?: string };
type TgChat = { id: number; type: string };
type TgUpdate = {
  message?: { text?: string; chat: TgChat; from?: TgUser };
  my_chat_member?: { chat: TgChat; new_chat_member?: { status?: string } };
};

const ok = () => new Response("ok", { status: 200 });

async function userLanguage(admin: ReturnType<typeof serviceClient>, userId: string, fallback?: string): Promise<NotifyLang> {
  const { data: profile } = await admin.from("profiles").select("active_workspace_id").eq("id", userId).maybeSingle();
  const workspaceId = profile?.active_workspace_id as string | null | undefined;
  if (workspaceId) {
    const { data: workspace } = await admin.from("workspaces").select("language").eq("id", workspaceId).maybeSingle();
    if (workspace?.language) return normalizeLang(String(workspace.language));
  }
  return normalizeLang(fallback);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
  const provided = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || !provided || !timingSafeEqual(provided, secret)) {
    return new Response("unauthorized", { status: 401 });
  }
  const botToken = readBotToken();
  if (!botToken) return ok();

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return ok();
  }
  const admin = serviceClient();

  // User blocked / unblocked the bot.
  if (update.my_chat_member) {
    const status = update.my_chat_member.new_chat_member?.status;
    if (status === "kicked") {
      await admin
        .from("user_telegram_links")
        .update({ is_active: false, last_error: "blocked_by_user", updated_at: new Date().toISOString() })
        .eq("chat_id", update.my_chat_member.chat.id);
    }
    return ok();
  }

  const message = update.message;
  if (!message?.text || message.chat.type !== "private") return ok();
  const chatId = message.chat.id;
  const text = message.text.trim();
  const fallbackLang = normalizeLang(message.from?.language_code);

  if (text.startsWith("/start")) {
    const token = text.slice("/start".length).trim();
    if (!token) {
      await sendTelegramMessage(botToken, chatId, { text: botTexts(fallbackLang).startHelp });
      return ok();
    }
    const { data: row } = await admin
      .from("telegram_link_tokens")
      .select("token, user_id, expires_at")
      .eq("token", token)
      .maybeSingle();
    if (!row || new Date(String(row.expires_at)).getTime() < Date.now()) {
      if (row) await admin.from("telegram_link_tokens").delete().eq("token", token);
      await sendTelegramMessage(botToken, chatId, { text: botTexts(fallbackLang).linkExpired });
      return ok();
    }
    const userId = String(row.user_id);
    // One chat ↔ one user: a chat previously linked to another account is moved to this one.
    await admin.from("user_telegram_links").delete().eq("chat_id", chatId).neq("user_id", userId);
    await admin.from("user_telegram_links").upsert(
      {
        user_id: userId,
        chat_id: chatId,
        username: message.from?.username ?? null,
        first_name: message.from?.first_name ?? null,
        is_active: true,
        last_error: null,
        linked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    await admin.from("telegram_link_tokens").delete().eq("user_id", userId);
    const lang = await userLanguage(admin, userId, message.from?.language_code);
    await sendTelegramMessage(botToken, chatId, { text: botTexts(lang).linked });
    return ok();
  }

  if (text === "/stop") {
    const { data: link } = await admin.from("user_telegram_links").select("user_id").eq("chat_id", chatId).maybeSingle();
    const lang = link?.user_id ? await userLanguage(admin, String(link.user_id), message.from?.language_code) : fallbackLang;
    await admin.from("user_telegram_links").delete().eq("chat_id", chatId);
    await sendTelegramMessage(botToken, chatId, { text: botTexts(lang).unlinked });
    return ok();
  }

  await sendTelegramMessage(botToken, chatId, { text: botTexts(fallbackLang).help });
  return ok();
});
