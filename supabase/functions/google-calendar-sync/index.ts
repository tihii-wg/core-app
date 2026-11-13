import { corsHeaders, corsOriginFor, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import {
  googleCalendarFetch,
  invalidateEventsCache,
  mapGoogleCalendarHttpError,
  workspaceCalendarAccessToken,
} from "../_shared/googleCalendar.ts";
import {
  buildDesiredOrderEvents,
  desiredToGoogleBody,
  hashDesiredEvent,
  syncBackoffMinutes,
  type DesiredGcalEvent,
  type OrderSyncSource,
  type SyncField,
  type SyncToggles,
} from "../_shared/gcalOrderSync.ts";
import { bearerToken, requireEnv, serviceClient, userClient } from "../_shared/supabase.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type ClaimRow = { workspace_id: string; order_id: string; attempts: number; enqueued_at: string };
type LinkRow = {
  workspace_id: string;
  order_id: string;
  field: SyncField;
  calendar_id: string;
  google_event_id: string;
  etag: string | null;
  synced_hash: string | null;
};

Deno.serve(async (req) => {
  const appUrl = corsOriginFor((Deno.env.get("APP_URL") ?? "").replace(/\/$/, ""), req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(appUrl) });
  }
  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "POST required", 405, appUrl);
  }

  try {
    const cronToken = req.headers.get("x-gcal-cron-token") ?? "";
    const expected = Deno.env.get("GCAL_CRON_TOKEN") ?? "";
    if (cronToken && expected && timingSafeEqual(cronToken, expected)) {
      return await runCron(appUrl);
    }

    const jwt = bearerToken(req);
    if (!jwt) return errorResponse("unauthorized", "Missing bearer token", 401, appUrl);
    const body = (await req.json().catch(() => ({}))) as { workspaceId?: string };
    const workspaceId = body.workspaceId?.trim() ?? "";
    if (!workspaceId) return errorResponse("invalid_args", "workspaceId required", 400, appUrl);

    const user = userClient(jwt);
    const { data: userData, error: userError } = await user.auth.getUser(jwt);
    if (userError || !userData.user) return errorResponse("unauthorized", "Invalid session", 401, appUrl);
    const { data: isMember } = await user.rpc("is_workspace_member", { target_workspace_id: workspaceId });
    if (isMember !== true) return errorResponse("forbidden", "Not a workspace member", 403, appUrl);

    const processed = await processWorkspace(serviceClient(), workspaceId, 20, appUrl);
    return jsonResponse({ ok: true, processed }, 200, appUrl);
  } catch (error) {
    console.error("[google-calendar-sync]", error instanceof Error ? error.message : error);
    return errorResponse("provider_error", error instanceof Error ? error.message : "sync failed", 500, appUrl);
  }
});

async function runCron(appUrl: string): Promise<Response> {
  const admin = serviceClient();
  const { data: workspaces, error } = await admin
    .from("workspace_google_calendar")
    .select("workspace_id")
    .not("calendar_id", "is", null);
  if (error) return errorResponse("provider_error", error.message, 500, appUrl);

  let total = 0;
  for (const row of workspaces ?? []) {
    const ws = row.workspace_id as string;
    total += await processWorkspace(admin, ws, 50, appUrl);
  }
  return jsonResponse({ ok: true, processed: total }, 200, appUrl);
}

async function processWorkspace(
  admin: SupabaseClient,
  workspaceId: string,
  limit: number,
  _appUrl: string,
): Promise<number> {
  const { data: settings } = await admin
    .from("workspace_google_calendar")
    .select(
      "calendar_id, calendar_time_zone, sync_orders, sync_measurement, sync_installation, google_email",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!settings?.calendar_id) return 0;

  const { data: wsRow } = await admin
    .from("workspaces")
    .select("timezone, language, currency")
    .eq("id", workspaceId)
    .maybeSingle();

  const timeZone =
    (typeof wsRow?.timezone === "string" && wsRow.timezone.trim()) ||
    (typeof settings.calendar_time_zone === "string" && settings.calendar_time_zone.trim()) ||
    "Europe/Chisinau";
  const locale =
    (typeof wsRow?.language === "string" && wsRow.language.trim().slice(0, 2)) || "ru";
  const currency = (typeof wsRow?.currency === "string" && wsRow.currency.trim()) || "";

  const toggles: SyncToggles = {
    syncOrders: settings.sync_orders === true,
    syncMeasurement: settings.sync_measurement === true,
    syncInstallation: settings.sync_installation === true,
  };

  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const appBase = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");

  const { data: claimed, error: claimError } = await admin.rpc("crm_gcal_claim_sync_batch_workspace", {
    p_workspace_id: workspaceId,
    p_limit: limit,
  });
  if (claimError) {
    console.error("[google-calendar-sync] claim", claimError.message);
    return 0;
  }
  if (!Array.isArray(claimed) || claimed.length === 0) return 0;

  // Token only when there is work. On failure the claimed rows come back after their lease (keep queue).
  const tokenResult = await workspaceCalendarAccessToken(admin, workspaceId, clientId, clientSecret);
  if ("error" in tokenResult) {
    return 0;
  }
  const accessToken = tokenResult.accessToken;
  const calendarId = settings.calendar_id as string;

  const rows = (Array.isArray(claimed) ? claimed : []) as ClaimRow[];
  let processed = 0;
  let changed = false;

  for (const row of rows) {
    const result = await syncOneOrder({
      admin,
      accessToken,
      workspaceId,
      orderId: row.order_id,
      attempts: row.attempts ?? 0,
      enqueuedAt: row.enqueued_at,
      calendarId,
      toggles,
      timeZone,
      locale,
      currency,
      appBase,
    });
    if (result === "reconnect") break;
    if (result === "changed") changed = true;
    processed += 1;
  }

  if (changed) invalidateEventsCache(workspaceId);
  return processed;
}

async function syncOneOrder(ctx: {
  admin: SupabaseClient;
  accessToken: string;
  workspaceId: string;
  orderId: string;
  attempts: number;
  enqueuedAt: string;
  calendarId: string;
  toggles: SyncToggles;
  timeZone: string;
  locale: string;
  currency: string;
  appBase: string;
}): Promise<"ok" | "changed" | "reconnect" | "retry"> {
  const { admin, workspaceId, orderId } = ctx;
  try {
    const loaded = await loadOrderSyncSource(admin, workspaceId, orderId, ctx.currency);
    const openUrl = `${ctx.appBase}/${ctx.locale}/${workspaceId}/orders?open=${encodeURIComponent(orderId)}`;
    const desired = buildDesiredOrderEvents({
      order: loaded.order,
      deleted: loaded.deleted,
      workspaceId,
      toggles: ctx.toggles,
      timeZone: ctx.timeZone,
      locale: ctx.locale,
      openUrl,
    });

    const { data: linksRaw } = await admin
      .from("gcal_order_event_links")
      .select("workspace_id, order_id, field, calendar_id, google_event_id, etag, synced_hash")
      .eq("workspace_id", workspaceId)
      .eq("order_id", orderId);
    const links = (linksRaw ?? []) as LinkRow[];
    const byField = new Map(links.map((l) => [l.field, l]));

    let changed = false;
    const desiredFields = new Set(desired.map((d) => d.field));

    for (const ev of desired) {
      const link = byField.get(ev.field) ?? null;
      const hash = hashDesiredEvent(ev);
      const outcome = await upsertDesiredEvent(ctx, ev, hash, link);
      if (outcome === "reconnect") return "reconnect";
      if (outcome === "retry") return "retry";
      if (outcome === "changed") changed = true;
    }

    for (const link of links) {
      if (desiredFields.has(link.field)) continue;
      const del = await deleteGoogleEvent(ctx.accessToken, link.calendar_id, link.google_event_id);
      if (del === "reconnect") return "reconnect";
      if (del === "retry") {
        await bumpRetry(admin, workspaceId, orderId, ctx.attempts, "delete_retry");
        return "retry";
      }
      await admin
        .from("gcal_order_event_links")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("order_id", orderId)
        .eq("field", link.field);
      changed = true;
    }

    await finishQueueItem(admin, workspaceId, orderId, ctx.enqueuedAt);
    return changed ? "changed" : "ok";
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync_error";
    if (message === "reconnect_required") return "reconnect";
    await bumpRetry(admin, workspaceId, orderId, ctx.attempts, message);
    return "retry";
  }
}

async function upsertDesiredEvent(
  ctx: {
    admin: SupabaseClient;
    accessToken: string;
    workspaceId: string;
    orderId: string;
    attempts: number;
    enqueuedAt: string;
    calendarId: string;
  },
  ev: DesiredGcalEvent,
  hash: string,
  link: LinkRow | null,
): Promise<"ok" | "changed" | "reconnect" | "retry"> {
  const body = desiredToGoogleBody(ev);

  // Calendar switched: delete old, create new
  if (link && link.calendar_id !== ctx.calendarId) {
    await deleteGoogleEvent(ctx.accessToken, link.calendar_id, link.google_event_id);
    link = null;
  }

  if (link && link.synced_hash === hash) return "ok";

  if (!link) {
    const created = await createGoogleEvent(ctx.accessToken, ctx.calendarId, body);
    if (created === "reconnect") return "reconnect";
    if (created === "retry") {
      await bumpRetry(ctx.admin, ctx.workspaceId, ctx.orderId, ctx.attempts, "create_retry");
      return "retry";
    }
    if (typeof created === "object" && "error4xx" in created) {
      await recordSyncError(ctx.admin, ctx.workspaceId, created.error4xx);
      await finishQueueItem(ctx.admin, ctx.workspaceId, ctx.orderId, ctx.enqueuedAt);
      return "ok";
    }
    await ctx.admin.from("gcal_order_event_links").upsert({
      workspace_id: ctx.workspaceId,
      order_id: ctx.orderId,
      field: ev.field,
      calendar_id: ctx.calendarId,
      google_event_id: created.id,
      etag: created.etag,
      synced_hash: hash,
      updated_at: new Date().toISOString(),
    });
    return "changed";
  }

  // PATCH existing
  const patched = await patchGoogleEvent(ctx.accessToken, ctx.calendarId, link.google_event_id, body, link.etag);
  if (patched === "reconnect") return "reconnect";
  if (patched === "retry") {
    await bumpRetry(ctx.admin, ctx.workspaceId, ctx.orderId, ctx.attempts, "patch_retry");
    return "retry";
  }
  if (patched === "gone") {
    // User deleted in Google: recreate only if payload changed vs last sync
    if (link.synced_hash && link.synced_hash !== hash) {
      const created = await createGoogleEvent(ctx.accessToken, ctx.calendarId, body);
      if (typeof created === "object" && "id" in created) {
        await ctx.admin.from("gcal_order_event_links").upsert({
          workspace_id: ctx.workspaceId,
          order_id: ctx.orderId,
          field: ev.field,
          calendar_id: ctx.calendarId,
          google_event_id: created.id,
          etag: created.etag,
          synced_hash: hash,
          updated_at: new Date().toISOString(),
        });
        return "changed";
      }
    }
    await ctx.admin
      .from("gcal_order_event_links")
      .delete()
      .eq("workspace_id", ctx.workspaceId)
      .eq("order_id", ctx.orderId)
      .eq("field", ev.field);
    return "changed";
  }
  if (typeof patched === "object" && "error4xx" in patched) {
    await recordSyncError(ctx.admin, ctx.workspaceId, patched.error4xx);
    await finishQueueItem(ctx.admin, ctx.workspaceId, ctx.orderId, ctx.enqueuedAt);
    return "ok";
  }

  await ctx.admin
    .from("gcal_order_event_links")
    .update({
      etag: patched.etag,
      synced_hash: hash,
      calendar_id: ctx.calendarId,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", ctx.workspaceId)
    .eq("order_id", ctx.orderId)
    .eq("field", ev.field);
  return "changed";
}

async function createGoogleEvent(
  accessToken: string,
  calendarId: string,
  body: Record<string, unknown>,
): Promise<{ id: string; etag: string | null } | "reconnect" | "retry" | { error4xx: string }> {
  const res = await googleCalendarFetch(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: "POST", body: JSON.stringify(body) },
  );
  const text = await res.text();
  if (res.ok) {
    const json = JSON.parse(text) as { id?: string; etag?: string };
    if (!json.id) return { error4xx: "create_missing_id" };
    return { id: json.id, etag: json.etag ?? null };
  }
  const mapped = mapGoogleCalendarHttpError(res.status, text);
  if (mapped.code === "reconnect_required") return "reconnect";
  if (mapped.retryable) return "retry";
  return { error4xx: mapped.message };
}

async function patchGoogleEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: Record<string, unknown>,
  etag: string | null,
): Promise<{ etag: string | null } | "gone" | "reconnect" | "retry" | { error4xx: string }> {
  const path = `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  let res = await googleCalendarFetch(accessToken, path, {
    method: "PATCH",
    body: JSON.stringify(body),
    ...(etag ? { etag } : {}),
  });
  if (res.status === 412) {
    const getRes = await googleCalendarFetch(accessToken, `${path}?fields=etag`);
    if (getRes.ok) {
      const fresh = (await getRes.json()) as { etag?: string };
      res = await googleCalendarFetch(accessToken, path, {
        method: "PATCH",
        body: JSON.stringify(body),
        ...(fresh.etag ? { etag: fresh.etag } : {}),
      });
    }
  }
  if (res.status === 404 || res.status === 410) return "gone";
  const text = await res.text();
  if (res.ok) {
    const json = text ? (JSON.parse(text) as { etag?: string }) : {};
    return { etag: json.etag ?? null };
  }
  const mapped = mapGoogleCalendarHttpError(res.status, text);
  if (mapped.code === "reconnect_required") return "reconnect";
  if (mapped.retryable) return "retry";
  return { error4xx: mapped.message };
}

async function deleteGoogleEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<"ok" | "reconnect" | "retry"> {
  const res = await googleCalendarFetch(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
  if (res.status === 204 || res.status === 404 || res.status === 410 || res.ok) return "ok";
  const text = await res.text();
  const mapped = mapGoogleCalendarHttpError(res.status, text);
  if (mapped.code === "reconnect_required") return "reconnect";
  if (mapped.retryable) return "retry";
  // Other 4xx: treat as gone
  return "ok";
}

/**
 * Remove the queue row only if it was not re-enqueued while we worked (trigger resets enqueued_at).
 * Otherwise make it due again so the newer change is synced on the next run.
 */
async function finishQueueItem(admin: SupabaseClient, workspaceId: string, orderId: string, enqueuedAt: string) {
  const { data: removed } = await admin
    .from("gcal_sync_queue")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("order_id", orderId)
    .eq("enqueued_at", enqueuedAt)
    .select("order_id");
  if (!removed || removed.length === 0) {
    await admin
      .from("gcal_sync_queue")
      .update({ next_attempt_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("order_id", orderId);
  }
}

async function bumpRetry(
  admin: SupabaseClient,
  workspaceId: string,
  orderId: string,
  attempts: number,
  lastError: string,
) {
  const nextAttempts = attempts + 1;
  const minutes = syncBackoffMinutes(nextAttempts);
  await admin
    .from("gcal_sync_queue")
    .update({
      attempts: nextAttempts,
      next_attempt_at: new Date(Date.now() + minutes * 60_000).toISOString(),
      last_error: lastError.slice(0, 500),
    })
    .eq("workspace_id", workspaceId)
    .eq("order_id", orderId);
  if (nextAttempts >= 8) {
    await recordSyncError(admin, workspaceId, lastError);
  }
}

async function recordSyncError(admin: SupabaseClient, workspaceId: string, message: string) {
  await admin
    .from("workspace_google_calendar")
    .update({ last_sync_error: message.slice(0, 500), updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId);
}

async function loadOrderSyncSource(
  admin: SupabaseClient,
  workspaceId: string,
  orderId: string,
  currency: string,
): Promise<{ order: OrderSyncSource | null; deleted: boolean }> {
  const { data: order, error } = await admin
    .from("orders")
    .select(
      "id, number, kind, status, custom_status_id, client_id, vehicle_id, deadline, measurement_at, installation_at, total_price, closed_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", orderId)
    .maybeSingle();

  // A read error is not a deletion: throw so the item retries with backoff instead of deleting Google events.
  if (error) throw new Error(`order_load_failed: ${error.message}`);
  if (!order) return { order: null, deleted: true };

  let cancelled = order.status === "cancelled";
  let statusLabel = String(order.status ?? "");
  if (order.custom_status_id) {
    const { data: def } = await admin
      .from("status_definitions")
      .select("name, semantic_action")
      .eq("id", order.custom_status_id)
      .maybeSingle();
    if (def?.name) statusLabel = String(def.name);
    if (def?.semantic_action === "cancel") cancelled = true;
  }

  let clientName = "";
  if (order.client_id) {
    const { data: client } = await admin.from("clients").select("name").eq("id", order.client_id).maybeSingle();
    clientName = typeof client?.name === "string" ? client.name.trim() : "";
  }

  let vehicleLabel = "";
  if (order.vehicle_id) {
    const { data: vehicle } = await admin
      .from("vehicles")
      .select("make, model, license_plate")
      .eq("id", order.vehicle_id)
      .maybeSingle();
    if (vehicle) {
      const mm = [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim();
      const plate = typeof vehicle.license_plate === "string" ? vehicle.license_plate.trim() : "";
      vehicleLabel = [mm, plate].filter(Boolean).join(" · ");
    }
  }

  const { data: services } = await admin
    .from("order_services")
    .select("service_name")
    .eq("order_id", orderId)
    .limit(10);
  const { data: materials } = await admin
    .from("order_materials")
    .select("item_name")
    .eq("order_id", orderId)
    .limit(10);

  const serviceNames = (services ?? [])
    .map((s) => (typeof s.service_name === "string" ? s.service_name.trim() : ""))
    .filter(Boolean);
  const materialNames = (materials ?? [])
    .map((m) => (typeof m.item_name === "string" ? m.item_name.trim() : ""))
    .filter(Boolean);
  const itemLines = [...serviceNames, ...materialNames].slice(0, 10);
  const firstServiceName = serviceNames[0] ?? "";

  const total =
    typeof order.total_price === "number"
      ? order.total_price
      : typeof order.total_price === "string"
        ? Number(order.total_price)
        : null;
  const totalLabel =
    total != null && Number.isFinite(total)
      ? `${total.toFixed(2)}${currency ? ` ${currency}` : ""}`
      : "";

  const closed = order.status === "closed" || Boolean(order.closed_at);

  return {
    deleted: false,
    order: {
      id: order.id,
      number: String(order.number ?? ""),
      kind: typeof order.kind === "string" ? order.kind : "order",
      status: typeof order.status === "string" ? order.status : null,
      statusLabel,
      cancelled,
      closed,
      clientName,
      vehicleLabel,
      firstServiceName,
      itemLines,
      totalLabel,
      deadline: typeof order.deadline === "string" ? order.deadline : null,
      measurementAt: typeof order.measurement_at === "string" ? order.measurement_at : null,
      installationAt: typeof order.installation_at === "string" ? order.installation_at : null,
    },
  };
}
