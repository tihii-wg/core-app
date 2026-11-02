/**
 * RO App import mapping tables (docs/ro-app-migration.md §7, Appendix В).
 *
 * Pure data + helpers: RO-ish spreadsheet headers (Russian/English) → Core App field keys per entity.
 * Nothing here talks to Supabase. Columns that match no field are NEVER dropped: the preview lists them as
 * `unknownColumns` and keeps their cell values per row (`extra`) so a future apply can stash them in `raw_ro_records`.
 */

export const importEntities = ["clients", "vehicles", "services", "inventory_items", "orders"] as const;
export type ImportEntity = (typeof importEntities)[number];

export type ImportFieldType = "string" | "number" | "integer" | "email" | "phone" | "date" | "enum";

export type ImportFieldDef = {
  /** Core App field key (also used as the i18n key under settings.migration.import.fields.<key>). */
  key: string;
  type: ImportFieldType;
  required?: boolean;
  /** Reject values below this bound (number / integer). */
  min?: number;
  max?: number;
  /** Allowed enum values; `enumSynonyms` maps normalised free text to one of them. */
  enumValues?: readonly string[];
  /** Normalised synonym → enum value. */
  enumSynonyms?: Readonly<Record<string, string>>;
  /** Extra header spellings. Compared after `normalizeHeader`. The key itself always matches. */
  aliases: readonly string[];
};

/** Lower-cases, folds ё→е, drops BOM/asterisks/colons and collapses punctuation and whitespace to single spaces. */
export function normalizeHeader(header: string) {
  return header
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[*:№#]/g, " ")
    .replace(/[_\-./\\()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const sourceId: ImportFieldDef = {
  key: "source_id",
  type: "string",
  aliases: ["id", "ид", "legacy id", "ro id", "id в ro", "внешний id", "external id", "source id", "код ro"],
};

const clientType: ImportFieldDef = {
  key: "client_type",
  type: "enum",
  enumValues: ["individual", "organization"],
  enumSynonyms: {
    individual: "individual",
    person: "individual",
    people: "individual",
    человек: "individual",
    физлицо: "individual",
    "физ лицо": "individual",
    "физическое лицо": "individual",
    organization: "organization",
    organisation: "organization",
    company: "organization",
    business: "organization",
    организация: "organization",
    юрлицо: "organization",
    "юр лицо": "organization",
    "юридическое лицо": "organization",
    автопарк: "organization",
  },
  aliases: ["тип", "тип контакта", "type", "contact type", "client type", "вид"],
};

export const importFieldDefs: Readonly<Record<ImportEntity, readonly ImportFieldDef[]>> = {
  clients: [
    sourceId,
    {
      key: "name",
      type: "string",
      required: true,
      aliases: ["имя контакта", "имя", "название", "контакт", "клиент", "наименование", "фио", "name", "client", "full name", "contact name"],
    },
    clientType,
    { key: "phone", type: "phone", aliases: ["телефон", "мобильный", "моб телефон", "тел", "phone", "mobile", "phone number"] },
    { key: "email", type: "email", aliases: ["email", "e mail", "почта", "эл почта", "электронная почта", "mail"] },
    { key: "address", type: "string", aliases: ["адрес", "address"] },
    { key: "contact_person", type: "string", aliases: ["доверенное лицо", "контактное лицо", "contact person"] },
    { key: "tax_id", type: "string", aliases: ["idno", "идно", "tax id", "tax number", "инн", "fiscal code", "фискальный код"] },
  ],
  vehicles: [
    sourceId,
    {
      key: "client_key",
      type: "string",
      required: true,
      aliases: ["имя контакта", "контакт", "клиент", "client", "client id", "id клиента", "client key", "владелец", "owner", "client name"],
    },
    { key: "make_model", type: "string", aliases: ["машина", "автомобиль", "авто", "марка модель", "car", "vehicle"] },
    { key: "make", type: "string", aliases: ["марка", "бренд", "brand"] },
    { key: "model", type: "string", aliases: ["модель"] },
    { key: "license_plate", type: "string", aliases: ["гос номер", "госномер", "гос номер авто", "номер авто", "license plate", "plate", "plate number", "reg number"] },
    { key: "vin", type: "string", aliases: ["вин номер", "вин", "vin code", "vin number"] },
    { key: "year", type: "integer", min: 1900, max: 2100, aliases: ["год выпуска", "год", "production year"] },
    { key: "initial_mileage", type: "integer", min: 0, aliases: ["пробег при регистрации", "начальный пробег", "initial mileage"] },
    { key: "current_mileage", type: "integer", min: 0, aliases: ["текущий пробег", "пробег", "mileage", "odometer"] },
    {
      key: "mileage_unit",
      type: "enum",
      enumValues: ["km", "mi"],
      enumSynonyms: {
        km: "km",
        kilometer: "km",
        kilometers: "km",
        км: "km",
        километр: "km",
        километры: "km",
        mi: "mi",
        mile: "mi",
        miles: "mi",
        миля: "mi",
        мили: "mi",
      },
      aliases: ["единица пробега", "единица одометра", "mileage unit", "odometer unit", "unit"],
    },
    { key: "engine_displacement", type: "number", min: 0, aliases: ["объем двигателя", "объем двигателя тип топлива", "объем", "engine", "engine size", "displacement"] },
    { key: "fuel_type", type: "string", aliases: ["тип топлива", "топливо", "fuel", "fuel type"] },
  ],
  services: [
    sourceId,
    { key: "name", type: "string", required: true, aliases: ["название", "наименование", "услуга", "работа", "name", "service", "service name"] },
    {
      key: "kind",
      type: "enum",
      enumValues: ["labor", "service"],
      enumSynonyms: { labor: "labor", работа: "labor", работы: "labor", service: "service", услуга: "service", услуги: "service" },
      aliases: ["тип", "вид", "type", "kind"],
    },
    { key: "category", type: "string", aliases: ["категория", "группа", "category", "group"] },
    { key: "price", type: "number", min: 0, aliases: ["цена", "стоимость", "цена продажи", "price", "sale price"] },
    { key: "cost", type: "number", min: 0, aliases: ["себестоимость", "закупочная цена", "cost"] },
    { key: "duration_minutes", type: "integer", min: 0, aliases: ["длительность", "длительность мин", "duration", "duration minutes"] },
    { key: "unit", type: "string", aliases: ["единица", "единица измерения", "ед изм", "unit"] },
    { key: "description", type: "string", aliases: ["описание", "description"] },
  ],
  inventory_items: [
    sourceId,
    { key: "name", type: "string", required: true, aliases: ["название", "наименование", "товар", "name", "item", "product"] },
    { key: "sku", type: "string", aliases: ["sku", "артикул", "внутренний код", "код", "code", "mpn"] },
    { key: "category", type: "string", aliases: ["категория", "группа", "category", "group"] },
    { key: "unit", type: "string", aliases: ["единица измерения", "единица", "ед изм", "unit"] },
    { key: "price", type: "number", min: 0, aliases: ["цена", "цена продажи", "розничная цена", "selling price", "sale price", "price"] },
    { key: "cost", type: "number", min: 0, aliases: ["себестоимость", "закупочная цена", "цена закупки", "purchase price", "cost"] },
    { key: "quantity", type: "number", aliases: ["остаток", "количество", "кол во", "qty", "quantity", "stock"] },
    { key: "description", type: "string", aliases: ["описание", "description"] },
  ],
  orders: [
    sourceId,
    {
      key: "legacy_number",
      type: "string",
      required: true,
      aliases: ["номер", "номер заказа", "заказ", "order number", "number", "order no", "legacy number"],
    },
    {
      key: "client_key",
      type: "string",
      aliases: ["клиент", "контакт", "имя контакта", "client", "client id", "id клиента", "client key", "client name"],
    },
    { key: "status", type: "string", aliases: ["статус", "status"] },
    { key: "service_type", type: "string", aliases: ["тип услуги", "тип заказа", "service type", "order type"] },
    { key: "total", type: "number", min: 0, aliases: ["сумма", "итого", "итог", "total", "amount", "total price"] },
    { key: "created_at", type: "date", aliases: ["создан", "дата создания", "дата", "created", "created at", "date"] },
    { key: "deadline", type: "date", aliases: ["срок", "срок выполнения", "deadline", "due date"] },
    { key: "license_plate", type: "string", aliases: ["гос номер", "госномер", "номер авто", "license plate", "plate"] },
    { key: "vin", type: "string", aliases: ["вин номер", "вин", "vin"] },
    { key: "malfunction", type: "string", aliases: ["неисправность", "malfunction", "problem", "complaint"] },
  ],
};

export type ImportHeaderMapping = {
  /** Same length/order as the input headers: matched Core field key, or null when the column is unknown. */
  fields: (string | null)[];
  /** Original header text of every column that matched no field (or lost to an earlier column for the same field). */
  unknownColumns: string[];
  /** Original headers that lost to an earlier column mapped to the same field (subset of `unknownColumns`). */
  duplicateMappings: string[];
  /** Required field keys with no matching column. */
  missingRequired: string[];
};

function aliasIndex(entity: ImportEntity) {
  const map = new Map<string, string>();
  for (const def of importFieldDefs[entity]) {
    map.set(normalizeHeader(def.key), def.key);
  }
  // Aliases never override an exact key match.
  for (const def of importFieldDefs[entity]) {
    for (const alias of def.aliases) {
      const normalized = normalizeHeader(alias);
      if (!map.has(normalized)) map.set(normalized, def.key);
    }
  }
  return map;
}

/** Maps spreadsheet headers to Core fields for one entity. Unknown columns are collected, never discarded. */
export function mapImportHeaders(entity: ImportEntity, headers: readonly string[]): ImportHeaderMapping {
  const index = aliasIndex(entity);
  const used = new Set<string>();
  const unknownColumns: string[] = [];
  const duplicateMappings: string[] = [];

  const fields = headers.map((header) => {
    const key = index.get(normalizeHeader(header)) ?? null;
    if (!key) {
      unknownColumns.push(header);
      return null;
    }
    if (used.has(key)) {
      unknownColumns.push(header);
      duplicateMappings.push(header);
      return null;
    }
    used.add(key);
    return key;
  });

  const missingRequired = importFieldDefs[entity].filter((def) => def.required && !used.has(def.key)).map((def) => def.key);
  return { fields, unknownColumns, duplicateMappings, missingRequired };
}

export function importFieldDef(entity: ImportEntity, key: string) {
  return importFieldDefs[entity].find((def) => def.key === key);
}
