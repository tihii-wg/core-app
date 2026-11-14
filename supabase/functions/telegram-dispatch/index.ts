/**
 * Sends queued Telegram notifications (public.notification_outbox).
 * Called by pg_net right after rows are queued and every minute by pg_cron.
 * Auth: header x-telegram-cron-token === TELEGRAM_CRON_TOKEN (no user JWT).
 * Deploy: supabase functions deploy telegram-dispatch --project-ref <ref> --no-verify-jwt
 */
import { timingSafeEqual } from "../_shared/crypto.ts";
import { requireEnv, serviceClient } from "../_shared/supabase.ts";
import {
  buildNotificationMessage,
  sendTelegramMessage,
  type OutboxRow,
  type WorkspaceInfo,
} from "../_shared/telegram.ts";

const MAX_PER_RUN = 200;
const TIME_BUDGET_MS = 25_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const provided = req.headers.get("x-telegram-cron-token") ?? "";
  const expected = Deno.env.get("TELEGRAM_CRON_TOKEN") ?? "";
  if (!provided || !expected || !timingSafeEqual(provided, expected)) {
    return json({ error: "unauthorized" }, 401);
  }

  let botToken: string;
  try {
    botToken = requireEnv("TELEGRAM_BOT_TOKEN");
  } catch {
    return json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 500);
  }
  const appUrl = Deno.env.get("APP_URL") ?? "";
  const admin = serviceClient();
  const startedAt = Date.now();

  const { data: claimed, error: claimError } = await admin.rpc("crm_notify_claim", { p_limit: MAX_PER_RUN });
  if (claimError) return json({ error: claimError.message }, 500);
  const rows = (claimed ?? []) as OutboxRow[];
  if (rows.length === 0) return json({ sent: 0 });

  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const workspaceIds = [...new Set(rows.map((row) => row.workspace_id))];

  const [{ data: links }, { data: workspaces }] = await Promise.all([
    admin.from("user_telegram_links").select("user_id, chat_id, is_active").in("user_id", userIds),
    admin.from("workspaces").select("id, name, language, currency").in("id", workspaceIds),
  ]);
  const linkByUser = new Map((links ?? []).map((link) => [String(link.user_id), link]));
  const workspaceById = new Map(
    ((workspaces ?? []) as WorkspaceInfo[]).map((workspace) => [String(workspace.id), workspace]),
  );

  let sent = 0;
  let failed = 0;
  let rateLimited = false;

  for (const row of rows) {
    if (rateLimited || Date.now() - startedAt > TIME_BUDGET_MS) {
      // Release the claim so the next run picks it up without burning an attempt.
      await admin
        .from("notification_outbox")
        .update({ claimed_at: null, attempts: Math.max(0, (row.attempts ?? 1) - 1) })
        .eq("id", row.id);
      continue;
    }

    const link = linkByUser.get(row.user_id);
    if (!link || !link.is_active) {
      await admin
        .from("notification_outbox")
        .update({ sent_at: new Date().toISOString(), last_error: "no_active_link" })
        .eq("id", row.id);
      continue;
    }

    const message = buildNotificationMessage(row, workspaceById.get(row.workspace_id) ?? null, appUrl);
    const result = await sendTelegramMessage(botToken, link.chat_id as number, message);

    if (result.ok) {
      sent += 1;
      await admin
        .from("notification_outbox")
        .update({ sent_at: new Date().toISOString(), last_error: null })
        .eq("id", row.id);
      continue;
    }

    failed += 1;
    if (result.blocked) {
      // User blocked the bot or deleted the chat: stop sending until they reconnect.
      await admin
        .from("user_telegram_links")
        .update({ is_active: false, last_error: result.error, updated_at: new Date().toISOString() })
        .eq("user_id", row.user_id);
      await admin
        .from("notification_outbox")
        .update({ sent_at: new Date().toISOString(), last_error: result.error })
        .eq("id", row.id);
      continue;
    }
    if (result.retryAfter != null) rateLimited = true;
    await admin
      .from("notification_outbox")
      .update({ claimed_at: null, last_error: result.error })
      .eq("id", row.id);
  }

  return json({ sent, failed, rateLimited });
});
