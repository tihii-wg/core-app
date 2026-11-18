/**
 * RO App spreadsheet import: turns the rows of an exported .xls (people, organisations, services, parts, orders)
 * into the payloads the import RPCs expect (supabase/manual/20261118180000_ro_import.PRODUCTION.sql).
 * Pure functions — no DOM, no Supabase — so the whole mapping is unit-testable.
 */

export type RoImportKind = "people" | "organizations" | "services" | "materials" | "orders";

export type SheetCell = string | number | boolean | Date | null | undefined;

export type RoVehicle = {
  make: string | null;
  model: string | null;
  year: string | null;
  vin: string | null;
  plate: string | null;
  initial_mileage: number | null;
  current_mileage: number | null;
  mileage_unit: "km" | "mi" | null;
  engine_l: number | null;
  fuel: string | null;
};

export type RoClientRow = {
  source_id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  client_type: "individual" | "organization";
  tax_id: string | null;
  contact_person: string | null;
  is_supplier: boolean;
  discount_card: string | null;
  created_at: string | null;
  balance: number;
  currency: string;
  vehicles: RoVehicle[];
};

export type RoServiceRow = { name: string; kind: "labor" | "service"; price: number; cost: number; warranty_months: number };

export type RoMaterialRow = {
  name: string;
  sku: string | null;
  mpn: string | null;
  brand: string | null;
  description: string | null;
  category: string | null;
  unit: string;
  cost: number;
  price: number;
  stock: number;
};

export type RoOrderLine = { name: string; qty: number; unit: string; price: number; mileage: number | null };

export type RoOrderRow = {
  number: string;
  created_at: string | null;
  deadline: string | null;
  closed_at: string | null;
  scheduled_from: string | null;
  scheduled_to: string | null;
  state: "closed" | "cancelled" | "open";
  status_name: string;
  client: { name: string; phone: string | null; client_type: "individual" | "organization"; email: string | null };
  vehicle: RoVehicle | null;
  manager: string | null;
  executor: string | null;
  total: number;
  paid: number;
  service_type: string | null;
  description: string | null;
  technician_notes: string | null;
  manager_notes: string | null;
  malfunction: string | null;
  mileage: number | null;
  mileage_unit: "km" | "mi" | null;
  services: RoOrderLine[];
  materials: RoOrderLine[];
};

export type RoIssue = { row: number; message: string };

export type RoParsed =
  | { kind: "people" | "organizations"; rows: RoClientRow[]; issues: RoIssue[]; sourceRows: number }
  | { kind: "services"; rows: RoServiceRow[]; issues: RoIssue[]; sourceRows: number }
  | { kind: "materials"; rows: RoMaterialRow[]; issues: RoIssue[]; sourceRows: number }
  | { kind: "orders"; rows: RoOrderRow[]; issues: RoIssue[]; sourceRows: number };

/* -------------------------------------------------------------------------------------------------
 * Cells
 * -----------------------------------------------------------------------------------------------*/

export function cellText(value: SheetCell): string {
  if (value == null) return "";
  if (value instanceof Date) return localIso(value);
  return String(value).trim();
}

function textOrNull(value: SheetCell): string | null {
  const text = cellText(value);
  return text ? text : null;
}

export function cellNumber(value: SheetCell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = cellText(value).replace(/\s/g, "").replace(",", ".");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** Wall-clock "YYYY-MM-DDTHH:MM:SS" from a Date whose UTC fields hold the local time. */
function localIso(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(
    date.getUTCMinutes(),
  )}:${pad(date.getUTCSeconds())}`;
}

/**
 * Excel serial date (RO App stores dates as numbers) or "YYYY-MM-DD HH:MM:SS" → wall-clock ISO without zone.
 * The server reads it in the workspace time zone.
 */
export function cellDateTime(value: SheetCell): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!(value > 1 && value < 2958466)) return null;
    const ms = Math.round((value - 25569) * 86400 * 1000);
    return localIso(new Date(ms));
  }
  if (value instanceof Date) return localIso(value);
  const text = cellText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}T${match[4] ?? "00"}:${match[5] ?? "00"}:${match[6] ?? "00"}`;
  }
  const dotted = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
  if (dotted) {
    return `${dotted[3]}-${dotted[2]}-${dotted[1]}T${dotted[4] ?? "00"}:${dotted[5] ?? "00"}:${dotted[6] ?? "00"}`;
  }
  const numeric = cellNumber(text);
  return numeric != null ? cellDateTime(numeric) : null;
}

/* -------------------------------------------------------------------------------------------------
 * Header lookup
 * -----------------------------------------------------------------------------------------------*/

export function normalizeHeaderName(value: string) {
  return value.replace(/^﻿/, "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

type Columns = { index: (header: string, occurrence?: number) => number };

function columnsOf(headers: string[]): Columns {
  const normalized = headers.map((header) => normalizeHeaderName(String(header ?? "")));
  return {
    index(header, occurrence = 0) {
      const wanted = normalizeHeaderName(header);
      let seen = 0;
      for (let i = 0; i < normalized.length; i += 1) {
        if (normalized[i] === wanted) {
          if (seen === occurrence) return i;
          seen += 1;
        }
      }
      return -1;
    },
  };
}

function cellAt(row: SheetCell[], index: number): SheetCell {
  return index >= 0 ? row[index] : undefined;
}

/** Which RO App export this sheet is, by its header row. */
export function detectRoImportKind(headers: string[]): RoImportKind | null {
  const set = new Set(headers.map((header) => normalizeHeaderName(String(header ?? ""))));
  if (set.has("заказ №")) return "orders";
  if (set.has("id контакта") && set.has("название организации")) return "organizations";
  if (set.has("id контакта") && set.has("полное имя")) return "people";
  if (set.has("стандартная цена") && set.has("наименование")) return "services";
  if (set.has("наименование") && (set.has("розничная") || set.has("остаток"))) return "materials";
  return null;
}

/* -------------------------------------------------------------------------------------------------
 * Vehicles, mileage, phones
 * -----------------------------------------------------------------------------------------------*/

/** "54880 miles", "110 906 км", "155000 km" → value + unit. */
export function parseMileage(value: SheetCell): { value: number; unit: "km" | "mi" } | null {
  const text = cellText(value).toLowerCase();
  if (!text) return null;
  const match = /(\d[\d\s.,]*)\s*(km|км|miles|mile|mi|ми)?/.exec(text);
  if (!match) return null;
  const digits = (match[1] ?? "").replace(/[\s.,]/g, "");
  const number = Number(digits);
  if (!Number.isFinite(number) || number < 0) return null;
  const unit = match[2] && /^(miles|mile|mi|ми)$/.test(match[2]) ? "mi" : "km";
  return { value: Math.floor(number), unit };
}

const FUEL_RULES: Array<[RegExp, string]> = [
  [/electr|электр/i, "electric"],
  [/hib|hyb|гибр/i, "hybrid"],
  [/gpl|lpg|газ|gaz|propan/i, "lpg"],
  [/motorin|diesel|дизел/i, "diesel"],
  [/benzin|бензин|petrol|gasoline/i, "petrol"],
];

/** "1395 cm3 / Hibrid-Benzin" → { engine_l: 1.395, fuel: "hybrid" }. */
export function parseEngineFuel(value: SheetCell): { engine_l: number | null; fuel: string | null } {
  const text = cellText(value);
  if (!text) return { engine_l: null, fuel: null };
  const cc = /(\d{3,5})\s*(?:cm3|см3|cc|см³|cm³)/i.exec(text);
  const engine = cc ? Math.round((Number(cc[1]) / 1000) * 1000) / 1000 : null;
  const fuelPart = text.includes("/") ? text.slice(text.indexOf("/") + 1) : text;
  const fuel = FUEL_RULES.find(([pattern]) => pattern.test(fuelPart))?.[1] ?? null;
  return { engine_l: engine && engine > 0 && engine < 100 ? engine : null, fuel };
}

/** "Toyota Yaris" → make Toyota / model Yaris; "Mercedes-Benz GLC200" keeps the hyphen. */
export function splitMakeModel(value: SheetCell): { make: string | null; model: string | null } {
  const text = cellText(value).replace(/\s+/g, " ");
  if (!text) return { make: null, model: null };
  const space = text.indexOf(" ");
  if (space < 0) return { make: text, model: null };
  return { make: text.slice(0, space), model: text.slice(space + 1) || null };
}

function vehicleFrom(row: SheetCell[], cols: Columns): RoVehicle | null {
  const car = cellAt(row, cols.index("Машина"));
  const vin = textOrNull(cellAt(row, cols.index("Вин номер")));
  const plate = textOrNull(cellAt(row, cols.index("Гос номер")));
  if (!cellText(car) && !vin && !plate) return null;
  const { make, model } = splitMakeModel(car);
  const initial = parseMileage(cellAt(row, cols.index("Пробег при регистрации")));
  const current = parseMileage(cellAt(row, cols.index("Текущий пробег")));
  const engineCell =
    cellText(cellAt(row, cols.index("Объём двигателя/Тип топлива"))) ||
    cellText(cellAt(row, cols.index("Объём двигателя / Тип топлива")));
  const { engine_l, fuel } = parseEngineFuel(engineCell);
  const year = cellNumber(cellAt(row, cols.index("Год выпуска")));
  return {
    make,
    model,
    year: year && year > 1886 && year < 2200 ? String(Math.floor(year)) : null,
    vin: vin && /[^0\s]/.test(vin) ? vin : null,
    plate,
    initial_mileage: initial?.value ?? null,
    current_mileage: current?.value ?? initial?.value ?? null,
    mileage_unit: current?.unit ?? initial?.unit ?? null,
    engine_l,
    fuel,
  };
}

function normalizedPhone(value: SheetCell): string | null {
  const text = cellText(value);
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  // RO App placeholders (3730000000…) are not real numbers.
  if (!digits || /^373?0+$/.test(digits)) return null;
  return text.startsWith("+") ? text : digits.length >= 11 ? `+${digits}` : digits;
}

const ORG_NAME_PATTERN = /\b(s\.?\s?r\.?\s?l\.?|s\.?a\.?|i\.?i\.?|î\.?i\.?|i\.?s\.?|ics|ong|a\.?o\.?|ooo|ооо|ltd|gmbh)\b/i;

/* -------------------------------------------------------------------------------------------------
 * Clients
 * -----------------------------------------------------------------------------------------------*/

function clientKey(name: string) {
  return normalizeHeaderName(name);
}

export function parseRoClients(headers: string[], rows: SheetCell[][], kind: "people" | "organizations") {
  const cols = columnsOf(headers);
  const issues: RoIssue[] = [];
  const out: RoClientRow[] = [];
  const orgByName = new Map<string, RoClientRow>();
  const nameHeader = kind === "organizations" ? "Название организации" : "Полное имя";

  rows.forEach((row, index) => {
    const line = index + 2;
    const sourceId = cellText(cellAt(row, cols.index("ID контакта")));
    const name = cellText(cellAt(row, cols.index(nameHeader)));
    if (!sourceId && !name) return;
    if (!name) {
      issues.push({ row: line, message: "noName" });
      return;
    }
    const vehicle = vehicleFrom(row, cols);
    const phone = normalizedPhone(cellAt(row, cols.index("Телефон")));
    const note = textOrNull(cellAt(row, cols.index("Примечание")));
    // Organisations: RO keeps one contact per car under the same company name → one client, several cars.
    if (kind === "organizations") {
      const existing = orgByName.get(clientKey(name));
      if (existing) {
        if (vehicle) existing.vehicles.push(vehicle);
        if (phone && existing.phone !== phone) {
          existing.notes = [existing.notes, phone].filter(Boolean).join("\n");
        }
        return;
      }
    }
    const client: RoClientRow = {
      source_id: sourceId || `name:${clientKey(name)}`,
      name,
      first_name: kind === "people" ? textOrNull(cellAt(row, cols.index("Имя"))) : null,
      last_name: kind === "people" ? textOrNull(cellAt(row, cols.index("Фамилия"))) : null,
      phone,
      email: textOrNull(cellAt(row, cols.index("Email"))),
      address: textOrNull(cellAt(row, cols.index("Адрес"))),
      notes: note,
      client_type: kind === "organizations" ? "organization" : "individual",
      tax_id: textOrNull(cellAt(row, cols.index("IDNO"))) ?? textOrNull(cellAt(row, cols.index("IDNO/CNP"))),
      contact_person: kind === "organizations" ? textOrNull(cellAt(row, cols.index("Доверенное лицо"))) : null,
      is_supplier: /^да|yes|true$/i.test(cellText(cellAt(row, cols.index("Поставщик")))),
      discount_card: textOrNull(cellAt(row, cols.index("Скидочная карта"))),
      created_at: cellDateTime(cellAt(row, cols.index("Дата создания"))),
      balance: cellNumber(cellAt(row, cols.index("Баланс"))) ?? 0,
      currency: cellText(cellAt(row, cols.index("Валюта"))) || "MDL",
      vehicles: vehicle ? [vehicle] : [],
    };
    if (kind === "organizations") orgByName.set(clientKey(name), client);
    out.push(client);
  });
  return { rows: out, issues };
}

/* -------------------------------------------------------------------------------------------------
 * Catalog
 * -----------------------------------------------------------------------------------------------*/

export function parseRoServices(headers: string[], rows: SheetCell[][]) {
  const cols = columnsOf(headers);
  const issues: RoIssue[] = [];
  const seen = new Set<string>();
  const out: RoServiceRow[] = [];
  rows.forEach((row, index) => {
    const name = cellText(cellAt(row, cols.index("Наименование")));
    if (!name) return;
    const key = normalizeHeaderName(name);
    if (seen.has(key)) {
      issues.push({ row: index + 2, message: "duplicateName" });
      return;
    }
    seen.add(key);
    const warranty = cellNumber(cellAt(row, cols.index("Гарантия"))) ?? 0;
    const period = cellText(cellAt(row, cols.index("Гарантийный период"))).toLowerCase();
    const months = warranty > 0 ? (period.startsWith("мес") ? warranty : period.startsWith("дн") ? Math.round(warranty / 30) : warranty) : 0;
    out.push({
      name,
      kind: /работ/i.test(cellText(cellAt(row, cols.index("Тип")))) ? "labor" : "service",
      price: cellNumber(cellAt(row, cols.index("Стандартная цена"))) ?? 0,
      cost: cellNumber(cellAt(row, cols.index("Себестоимость"))) ?? 0,
      warranty_months: Math.max(0, Math.floor(months)),
    });
  });
  return { rows: out, issues };
}

const UNIT_MAP: Record<string, string> = { pcs: "шт.", ea: "шт.", шт: "шт.", l: "л", pack: "уп.", уп: "уп.", m: "м" };

export function parseRoMaterials(headers: string[], rows: SheetCell[][]) {
  const cols = columnsOf(headers);
  const issues: RoIssue[] = [];
  const seen = new Set<string>();
  const out: RoMaterialRow[] = [];
  rows.forEach((row, index) => {
    const name = cellText(cellAt(row, cols.index("Наименование")));
    if (!name) return;
    const key = normalizeHeaderName(name);
    if (seen.has(key)) {
      issues.push({ row: index + 2, message: "duplicateName" });
      return;
    }
    seen.add(key);
    const unitRaw = cellText(cellAt(row, cols.index("Единица измерения"))).toLowerCase();
    out.push({
      name,
      sku: textOrNull(cellAt(row, cols.index("Внутренний код"))),
      mpn: textOrNull(cellAt(row, cols.index("Код производителя"))),
      brand: textOrNull(cellAt(row, cols.index("Артикул"))),
      description: textOrNull(cellAt(row, cols.index("Описание"))),
      category: textOrNull(cellAt(row, cols.index("Категория"))),
      unit: UNIT_MAP[unitRaw] ?? (unitRaw || "шт."),
      cost: cellNumber(cellAt(row, cols.index("Себестоимость"))) ?? 0,
      price: cellNumber(cellAt(row, cols.index("Розничная"))) ?? 0,
      stock: Math.max(0, cellNumber(cellAt(row, cols.index("Остаток"))) ?? 0),
    });
  });
  return { rows: out, issues };
}

/* -------------------------------------------------------------------------------------------------
 * Orders
 * -----------------------------------------------------------------------------------------------*/

const LINE_PATTERN =
  /^(?<name>.*?)\s+-\s+(?<qty>-?\d+(?:[.,]\d+)?)\s*(?<unit>[^\d\s-][^-]*?)?\s+-\s+(?<price>-?\d+(?:[.,]\d+)?)\s*[A-Za-z]{3}\s*$/;
const LINE_MILEAGE = /\s*\((?<mileage>\d[\d\s]*)\s*(?<unit>km|км|miles|mile|mi|ми)\)\s*$/i;

/**
 * RO App writes order lines as text, one per line: "Замена газовых фильтров (73362 miles) - 1 шт - 400 MDL".
 * A long name can wrap onto the next line — unmatched text is joined with the following line.
 */
export function parseRoOrderLines(text: SheetCell): { lines: RoOrderLine[]; unparsed: string[] } {
  const value = cellText(text);
  const lines: RoOrderLine[] = [];
  const unparsed: string[] = [];
  if (!value) return { lines, unparsed };
  let pending = "";
  for (const rawLine of value.split(/\r?\n/)) {
    const raw = pending ? `${pending} ${rawLine.trim()}`.trim() : rawLine.trim();
    if (!raw) continue;
    const match = LINE_PATTERN.exec(raw);
    if (!match?.groups) {
      pending = raw;
      continue;
    }
    pending = "";
    let name = (match.groups.name ?? "").trim();
    let mileage: number | null = null;
    const mileageMatch = LINE_MILEAGE.exec(name);
    if (mileageMatch?.groups) {
      mileage = Number((mileageMatch.groups.mileage ?? "").replace(/\s/g, "")) || null;
      name = name.slice(0, mileageMatch.index).trim();
    }
    lines.push({
      name,
      qty: Number((match.groups.qty ?? "1").replace(",", ".")),
      unit: (match.groups.unit ?? "").trim(),
      price: Number((match.groups.price ?? "0").replace(",", ".")),
      mileage,
    });
  }
  if (pending) unparsed.push(pending);
  return { lines, unparsed };
}

function orderState(status: string): RoOrderRow["state"] {
  const value = normalizeHeaderName(status);
  if (value === "закрыт" || value === "закрыт (оплачен)") return "closed";
  if (value === "отказ" || value === "отменен" || value === "отменён") return "cancelled";
  return "open";
}

export function parseRoOrders(
  headers: string[],
  rows: SheetCell[][],
  options: { organizationNames?: ReadonlySet<string> } = {},
) {
  const cols = columnsOf(headers);
  const issues: RoIssue[] = [];
  const out: RoOrderRow[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const line = index + 2;
    const number = cellText(cellAt(row, cols.index("Заказ №")));
    if (!number) return;
    if (seen.has(number)) {
      issues.push({ row: line, message: "duplicateNumber" });
      return;
    }
    seen.add(number);
    const services = parseRoOrderLines(cellAt(row, cols.index("Услуги/Работы")));
    const materials = parseRoOrderLines(cellAt(row, cols.index("Товары")));
    for (const text of [...services.unparsed, ...materials.unparsed]) {
      issues.push({ row: line, message: `unparsedLine:${text.slice(0, 80)}` });
    }
    const clientName = cellText(cellAt(row, cols.index("Имя клиента")));
    const vehicle = vehicleFrom(row, cols);
    const firstMileageLine = [...services.lines, ...materials.lines].find((item) => item.mileage != null);
    const lineMileageUnit = (() => {
      const raw = cellText(cellAt(row, cols.index("Услуги/Работы"))) + cellText(cellAt(row, cols.index("Товары")));
      return /\d\s*(miles|mile|mi|ми)\)/i.test(raw) ? "mi" : /\d\s*(km|км)\)/i.test(raw) ? "km" : null;
    })();
    const status = cellText(cellAt(row, cols.index("Статус")));
    const isOrg =
      (options.organizationNames?.has(normalizeHeaderName(clientName)) ?? false) || ORG_NAME_PATTERN.test(clientName);
    out.push({
      number,
      created_at: cellDateTime(cellAt(row, cols.index("Дата создания"))),
      deadline: cellDateTime(cellAt(row, cols.index("Крайний срок"))),
      closed_at: cellDateTime(cellAt(row, cols.index("Закрыт"))),
      scheduled_from: cellDateTime(cellAt(row, cols.index("Запланировано с"))),
      scheduled_to: cellDateTime(cellAt(row, cols.index("Запланировано до"))),
      state: orderState(status),
      status_name: status,
      client: {
        name: clientName || "—",
        phone: normalizedPhone(cellAt(row, cols.index("Телефон заказчика"))),
        client_type: isOrg ? "organization" : "individual",
        email: textOrNull(cellAt(row, cols.index("Email"))),
      },
      vehicle,
      manager: textOrNull(cellAt(row, cols.index("Менеджер"))),
      executor: textOrNull(cellAt(row, cols.index("Исполнитель"))),
      total: cellNumber(cellAt(row, cols.index("Сумма"))) ?? 0,
      paid: cellNumber(cellAt(row, cols.index("Оплачено"))) ?? 0,
      service_type: textOrNull(cellAt(row, cols.index("Тип услуги"))),
      description: textOrNull(cellAt(row, cols.index("Вердикт / рекомендации клиенту"))),
      technician_notes: textOrNull(cellAt(row, cols.index("Заметки исполнителя"))),
      manager_notes: textOrNull(cellAt(row, cols.index("Заметки менеджера"))),
      malfunction: textOrNull(cellAt(row, cols.index("Неисправность"))),
      mileage: firstMileageLine?.mileage ?? null,
      mileage_unit: firstMileageLine?.mileage != null ? (lineMileageUnit as "km" | "mi" | null) : null,
      services: services.lines,
      materials: materials.lines,
    });
  });
  return { rows: out, issues };
}

/* -------------------------------------------------------------------------------------------------
 * Entry point
 * -----------------------------------------------------------------------------------------------*/

export function parseRoSheet(
  headers: string[],
  rows: SheetCell[][],
  kindOverride?: RoImportKind | null,
  options: { organizationNames?: ReadonlySet<string> } = {},
): RoParsed | null {
  const kind = kindOverride ?? detectRoImportKind(headers);
  if (!kind) return null;
  const dataRows = rows.filter((row) => row.some((cell) => cellText(cell) !== ""));
  switch (kind) {
    case "people":
    case "organizations": {
      const parsed = parseRoClients(headers, dataRows, kind);
      return { kind, ...parsed, sourceRows: dataRows.length };
    }
    case "services": {
      const parsed = parseRoServices(headers, dataRows);
      return { kind, ...parsed, sourceRows: dataRows.length };
    }
    case "materials": {
      const parsed = parseRoMaterials(headers, dataRows);
      return { kind, ...parsed, sourceRows: dataRows.length };
    }
    case "orders": {
      const parsed = parseRoOrders(headers, dataRows, options);
      return { kind, ...parsed, sourceRows: dataRows.length };
    }
  }
}

/** Short numbers for the preview card. */
export function roParsedSummary(parsed: RoParsed) {
  switch (parsed.kind) {
    case "people":
    case "organizations":
      return {
        rows: parsed.rows.length,
        vehicles: parsed.rows.reduce((sum, row) => sum + row.vehicles.length, 0),
        balances: parsed.rows.filter((row) => row.balance !== 0).length,
      };
    case "services":
      return { rows: parsed.rows.length };
    case "materials":
      return { rows: parsed.rows.length, withStock: parsed.rows.filter((row) => row.stock > 0).length };
    case "orders": {
      const lines = parsed.rows.reduce((sum, row) => sum + row.services.length + row.materials.length, 0);
      return {
        rows: parsed.rows.length,
        lines,
        closed: parsed.rows.filter((row) => row.state === "closed").length,
        open: parsed.rows.filter((row) => row.state === "open").length,
        cancelled: parsed.rows.filter((row) => row.state === "cancelled").length,
        paidTotal: parsed.rows.reduce((sum, row) => sum + Math.max(0, row.paid), 0),
      };
    }
  }
}
