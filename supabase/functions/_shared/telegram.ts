/** Telegram Bot API helpers + notification message formatting (ru / ro / en). Never log tokens. */

export type NotifyLang = "ru" | "ro" | "en";

const BOT_TOKEN_RE = /\d{6,12}:[A-Za-z0-9_-]{30,}/;

/**
 * The bot token from TELEGRAM_BOT_TOKEN. Tolerates a pasted BotFather message around it
 * ("Use this token to access the HTTP API: 123:ABC…"), quotes or spaces: the first token-shaped match wins.
 */
export function extractBotToken(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  return BOT_TOKEN_RE.exec(value)?.[0] ?? value;
}

export function readBotToken(): string {
  return extractBotToken(Deno.env.get("TELEGRAM_BOT_TOKEN"));
}

export type OutboxRow = {
  id: number;
  workspace_id: string;
  user_id: string;
  event: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
  attempts?: number;
};

export type WorkspaceInfo = { id: string; name: string; language: string | null; currency: string | null };

export function normalizeLang(value: string | null | undefined): NotifyLang {
  const v = (value ?? "").toLowerCase();
  if (v.startsWith("ro")) return "ro";
  if (v.startsWith("en")) return "en";
  return "ru";
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return value == null ? "" : String(value).trim();
}

export function formatMoney(amount: unknown, currency: string | null | undefined, lang: NotifyLang): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "";
  const locale = lang === "ru" ? "ru-RU" : lang === "ro" ? "ro-RO" : "en-GB";
  const formatted = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  return currency ? `${formatted} ${currency}` : formatted;
}

export function formatDate(value: string, lang: NotifyLang): string {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  const locale = lang === "ru" ? "ru-RU" : lang === "ro" ? "ro-RO" : "en-GB";
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(date);
}

const SYSTEM_STATUS: Record<NotifyLang, Record<string, string>> = {
  ru: { new: "Новый", "in-progress": "В работе", completed: "Готов", paid: "Оплачен", closed: "Закрыт", cancelled: "Отменён" },
  ro: { new: "Nou", "in-progress": "În lucru", completed: "Gata", paid: "Achitat", closed: "Închis", cancelled: "Anulat" },
  en: { new: "New", "in-progress": "In progress", completed: "Completed", paid: "Paid", closed: "Closed", cancelled: "Cancelled" },
};

type Texts = {
  orderCreated: string; estimateCreated: string; statusChanged: string; closed: string; cancelled: string;
  assigned: string; payment: string; paymentNoOrder: string; stageDue: string; deadlineTomorrow: string;
  overdue: string; lowStock: string; client: string; total: string; deadline: string; openOrder: string;
  openItem: string; linked: string; linkExpired: string; startHelp: string; unlinked: string; help: string;
  taskAssigned: string; taskCompleted: string; taskFrom: string; taskBy: string; taskDue: string; openTasks: string;
};

const TEXTS: Record<NotifyLang, Texts> = {
  ru: {
    orderCreated: "🆕 Новый заказ <b>{n}</b>",
    estimateCreated: "📝 Новый расчёт <b>{n}</b>",
    statusChanged: "🔄 Заказ <b>{n}</b>: статус «{s}»",
    closed: "✅ Заказ <b>{n}</b> закрыт",
    cancelled: "❌ Заказ <b>{n}</b> отменён",
    assigned: "👤 Вам назначен заказ <b>{n}</b>",
    payment: "💰 Оплата <b>{a}</b> по заказу <b>{n}</b>",
    paymentNoOrder: "💰 Получена оплата <b>{a}</b>",
    stageDue: "📅 Завтра срок оплаты по заказу <b>{n}</b>: этап «{st}»",
    deadlineTomorrow: "⏰ Завтра срок заказа <b>{n}</b>",
    overdue: "⚠️ Заказ <b>{n}</b> просрочен (срок {d})",
    lowStock: "📦 Заканчивается <b>{name}</b>: осталось {q} {u} (минимум {m})",
    client: "Клиент",
    total: "Сумма",
    deadline: "Срок",
    openOrder: "Открыть заказ",
    openItem: "Открыть товар",
    taskAssigned: "📌 Вам поставлена задача: <b>{title}</b>",
    taskCompleted: "✅ Задача выполнена: <b>{title}</b>",
    taskFrom: "От",
    taskBy: "Выполнил(а)",
    taskDue: "Срок",
    openTasks: "Открыть задачи",
    linked: "✅ Telegram подключён к Core App. Выберите уведомления в «Настройки → Уведомления».",
    linkExpired: "Ссылка устарела. Откройте Core App → Настройки → Уведомления и нажмите «Подключить Telegram» ещё раз.",
    startHelp: "Чтобы получать уведомления, откройте Core App → Настройки → Уведомления и нажмите «Подключить Telegram».",
    unlinked: "Уведомления отключены. Подключить снова можно в Core App → Настройки → Уведомления.",
    help: "Этот бот присылает уведомления Core App. Команды: /stop — отключить уведомления.",
  },
  ro: {
    orderCreated: "🆕 Comandă nouă <b>{n}</b>",
    estimateCreated: "📝 Deviz nou <b>{n}</b>",
    statusChanged: "🔄 Comanda <b>{n}</b>: statut „{s}”",
    closed: "✅ Comanda <b>{n}</b> a fost închisă",
    cancelled: "❌ Comanda <b>{n}</b> a fost anulată",
    assigned: "👤 V-a fost atribuită comanda <b>{n}</b>",
    payment: "💰 Plată <b>{a}</b> pentru comanda <b>{n}</b>",
    paymentNoOrder: "💰 Plată primită <b>{a}</b>",
    stageDue: "📅 Mâine scade plata pentru comanda <b>{n}</b>: etapa „{st}”",
    deadlineTomorrow: "⏰ Mâine expiră termenul comenzii <b>{n}</b>",
    overdue: "⚠️ Comanda <b>{n}</b> a depășit termenul ({d})",
    lowStock: "📦 Se termină <b>{name}</b>: au rămas {q} {u} (minim {m})",
    client: "Client",
    total: "Sumă",
    deadline: "Termen",
    openOrder: "Deschide comanda",
    openItem: "Deschide articolul",
    taskAssigned: "📌 Vi s-a atribuit o sarcină: <b>{title}</b>",
    taskCompleted: "✅ Sarcină finalizată: <b>{title}</b>",
    taskFrom: "De la",
    taskBy: "Finalizată de",
    taskDue: "Termen",
    openTasks: "Deschide sarcinile",
    linked: "✅ Telegram este conectat la Core App. Alegeți notificările în „Setări → Notificări”.",
    linkExpired: "Linkul a expirat. Deschideți Core App → Setări → Notificări și apăsați din nou „Conectează Telegram”.",
    startHelp: "Pentru notificări deschideți Core App → Setări → Notificări și apăsați „Conectează Telegram”.",
    unlinked: "Notificările sunt dezactivate. Le puteți reconecta din Core App → Setări → Notificări.",
    help: "Acest bot trimite notificări Core App. Comenzi: /stop — dezactivează notificările.",
  },
  en: {
    orderCreated: "🆕 New order <b>{n}</b>",
    estimateCreated: "📝 New estimate <b>{n}</b>",
    statusChanged: "🔄 Order <b>{n}</b>: status “{s}”",
    closed: "✅ Order <b>{n}</b> closed",
    cancelled: "❌ Order <b>{n}</b> cancelled",
    assigned: "👤 Order <b>{n}</b> was assigned to you",
    payment: "💰 Payment <b>{a}</b> for order <b>{n}</b>",
    paymentNoOrder: "💰 Payment received <b>{a}</b>",
    stageDue: "📅 Payment due tomorrow for order <b>{n}</b>: stage “{st}”",
    deadlineTomorrow: "⏰ Order <b>{n}</b> is due tomorrow",
    overdue: "⚠️ Order <b>{n}</b> is overdue (due {d})",
    lowStock: "📦 Running low on <b>{name}</b>: {q} {u} left (minimum {m})",
    client: "Client",
    total: "Total",
    deadline: "Due",
    openOrder: "Open order",
    openItem: "Open item",
    taskAssigned: "📌 New task for you: <b>{title}</b>",
    taskCompleted: "✅ Task completed: <b>{title}</b>",
    taskFrom: "From",
    taskBy: "Done by",
    taskDue: "Due",
    openTasks: "Open tasks",
    linked: "✅ Telegram is connected to Core App. Choose notifications in Settings → Notifications.",
    linkExpired: "This link has expired. Open Core App → Settings → Notifications and tap “Connect Telegram” again.",
    startHelp: "To get notifications, open Core App → Settings → Notifications and tap “Connect Telegram”.",
    unlinked: "Notifications are off. You can reconnect in Core App → Settings → Notifications.",
    help: "This bot sends Core App notifications. Commands: /stop — turn notifications off.",
  },
};

export function botTexts(lang: NotifyLang): Texts {
  return TEXTS[lang];
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

export type BuiltMessage = { text: string; buttonText: string | null; buttonUrl: string | null };

/** Pure: builds the Telegram HTML message and the "open" button for one queued event. */
export function buildNotificationMessage(row: OutboxRow, workspace: WorkspaceInfo | null, appUrl: string): BuiltMessage {
  const lang = normalizeLang(workspace?.language);
  const t = TEXTS[lang];
  const p = row.payload ?? {};
  const currency = str(p, "currency") || workspace?.currency || "";
  const number = escapeHtml(str(p, "number") || "—");
  const statusCode = str(p, "status");
  const statusName = escapeHtml(str(p, "status_name") || SYSTEM_STATUS[lang][statusCode] || statusCode);

  let head = "";
  switch (row.event) {
    case "order_created": head = fill(t.orderCreated, { n: number }); break;
    case "estimate_created": head = fill(t.estimateCreated, { n: number }); break;
    case "order_status_changed": head = fill(t.statusChanged, { n: number, s: statusName }); break;
    case "order_closed": head = fill(t.closed, { n: number }); break;
    case "order_cancelled": head = fill(t.cancelled, { n: number }); break;
    case "order_assigned_to_me": head = fill(t.assigned, { n: number }); break;
    case "payment_received": {
      const amount = escapeHtml(formatMoney(p.amount, currency, lang));
      head = str(p, "number") ? fill(t.payment, { a: amount, n: number }) : fill(t.paymentNoOrder, { a: amount });
      break;
    }
    case "payment_stage_due": head = fill(t.stageDue, { n: number, st: escapeHtml(str(p, "stage")) }); break;
    case "order_deadline_tomorrow": head = fill(t.deadlineTomorrow, { n: number }); break;
    case "order_overdue": head = fill(t.overdue, { n: number, d: escapeHtml(formatDate(str(p, "deadline"), lang)) }); break;
    case "inventory_low_stock":
      head = fill(t.lowStock, {
        name: escapeHtml(str(p, "name")),
        q: escapeHtml(str(p, "quantity")),
        u: escapeHtml(str(p, "unit")),
        m: escapeHtml(str(p, "min_quantity")),
      });
      break;
    case "task_assigned": head = fill(t.taskAssigned, { title: escapeHtml(str(p, "title") || "—") }); break;
    case "task_completed": head = fill(t.taskCompleted, { title: escapeHtml(str(p, "title") || "—") }); break;
    default: head = escapeHtml(row.event);
  }

  const isTask = row.event === "task_assigned" || row.event === "task_completed";
  const lines = [head];
  if (isTask) {
    const description = str(p, "description");
    if (row.event === "task_assigned" && description) {
      lines.push(escapeHtml(description.length > 300 ? `${description.slice(0, 300)}…` : description));
    }
    // due_text is pre-formatted in the workspace time zone by the database trigger.
    const due = str(p, "due_text") || (str(p, "due_at") ? formatDate(str(p, "due_at"), lang) : "");
    if (row.event === "task_assigned" && due) lines.push(`${t.taskDue}: ${escapeHtml(due)}`);
    const person = str(p, "actor_name");
    if (person) lines.push(`${row.event === "task_assigned" ? t.taskFrom : t.taskBy}: ${escapeHtml(person)}`);
  } else if (row.event !== "inventory_low_stock") {
    const client = str(p, "client");
    if (client) lines.push(`${t.client}: ${escapeHtml(client)}`);
    const device = str(p, "device");
    if (device) lines.push(escapeHtml(device));
    if (row.event !== "payment_received" && p.total != null && Number(p.total) > 0) {
      lines.push(`${t.total}: ${escapeHtml(formatMoney(p.total, currency, lang))}`);
    }
    if ((row.event === "order_created" || row.event === "order_assigned_to_me") && str(p, "deadline")) {
      lines.push(`${t.deadline}: ${escapeHtml(formatDate(str(p, "deadline"), lang))}`);
    }
  }
  if (workspace?.name) lines.push(`<i>${escapeHtml(workspace.name)}</i>`);

  const base = appUrl.replace(/\/$/, "");
  let buttonUrl: string | null = null;
  let buttonText: string | null = null;
  if (base && row.workspace_id) {
    if (isTask) {
      buttonUrl = `${base}/${lang}/${row.workspace_id}/tasks`;
      buttonText = t.openTasks;
    } else if (row.event === "inventory_low_stock" && row.entity_id) {
      buttonUrl = `${base}/${lang}/${row.workspace_id}/inventory?item=${encodeURIComponent(row.entity_id)}`;
      buttonText = t.openItem;
    } else if (str(p, "order_id") || (row.entity_id && row.event !== "payment_received")) {
      const orderId = str(p, "order_id") || row.entity_id!;
      buttonUrl = `${base}/${lang}/${row.workspace_id}/orders?open=${encodeURIComponent(orderId)}`;
      buttonText = t.openOrder;
    }
  }
  return { text: lines.join("\n"), buttonText, buttonUrl };
}

export type SendResult =
  | { ok: true }
  | { ok: false; blocked: boolean; retryAfter: number | null; error: string };

export async function telegramApi(token: string, method: string, body: Record<string, unknown>): Promise<Response> {
  return await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function sendTelegramMessage(
  token: string,
  chatId: number | string,
  message: { text: string; buttonText?: string | null; buttonUrl?: string | null },
): Promise<SendResult> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: message.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  // Telegram rejects localhost URLs in buttons — only attach https links.
  if (message.buttonText && message.buttonUrl && /^https:\/\//.test(message.buttonUrl)) {
    body.reply_markup = { inline_keyboard: [[{ text: message.buttonText, url: message.buttonUrl }]] };
  }
  let res: Response;
  try {
    res = await telegramApi(token, "sendMessage", body);
  } catch (error) {
    return { ok: false, blocked: false, retryAfter: null, error: error instanceof Error ? error.message : "network_error" };
  }
  if (res.ok) return { ok: true };
  let json: { description?: string; parameters?: { retry_after?: number } } = {};
  try {
    json = await res.json();
  } catch {
    // ignore
  }
  const description = json.description ?? `http_${res.status}`;
  return {
    ok: false,
    // 403: user blocked the bot / deleted chat; 400 "chat not found" too.
    blocked: res.status === 403 || /chat not found|bot was blocked|user is deactivated/i.test(description),
    retryAfter: res.status === 429 ? Number(json.parameters?.retry_after ?? 5) : null,
    error: description.slice(0, 300),
  };
}
