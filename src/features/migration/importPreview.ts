/**
 * RO App import PREVIEW (docs/ro-app-migration.md §7) — pure, browser-only, dry-run.
 *
 * Parses a CSV or JSON-array export, maps its headers to Core fields (importMapping.ts), validates each row and
 * reports problems. It performs NO network calls and NO writes: the result lives only in local component state.
 * Applying an import is intentionally blocked (see `importApplyStatus`).
 */
import {
  importFieldDefs,
  mapImportHeaders,
  type ImportEntity,
  type ImportFieldDef,
} from "./importMapping";

export type ImportFormat = "csv" | "json";
export type ImportValue = string | number | null;
export type ImportSeverity = "error" | "warning";

export type ImportIssueCode =
  | "required"
  | "invalidNumber"
  | "negative"
  | "outOfRange"
  | "invalidEmail"
  | "invalidDate"
  | "invalidEnum"
  | "shortPhone"
  | "invalidVin"
  | "missingClientKey"
  | "noVehicleData"
  | "duplicateKey"
  | "duplicateSoft"
  | "missingRequiredColumn"
  | "missingClientColumn"
  | "duplicateColumn";

export type ImportIssue = {
  /** 1-based data row number (header excluded). 0 means the issue concerns the file/columns, not one row. */
  row: number;
  severity: ImportSeverity;
  code: ImportIssueCode;
  /** Core field key the issue is about (or the header text for column-level issues). */
  field?: string;
  /** Offending raw value, when useful. */
  value?: string;
  /** Number of rows in the duplicate group, for duplicate issues. */
  count?: number;
};

export type ImportRowStatus = "ok" | "warning" | "error";

export type ImportPreviewRow = {
  /** 1-based data row number (header excluded). */
  row: number;
  /** Parsed, normalised values keyed by Core field. Missing/invalid values are null. */
  values: Record<string, ImportValue>;
  /** Cells of unknown columns, keyed by their original header. Kept so nothing is silently discarded. */
  extra: Record<string, string>;
  status: ImportRowStatus;
  issues: ImportIssue[];
};

export type ImportDuplicateGroup = {
  /** Field that collided (phone, email, vin, license_plate, name, sku, legacy_number, source_id). */
  field: string;
  /** Normalised key shared by the rows. */
  key: string;
  /** 1-based data row numbers. */
  rows: number[];
  severity: ImportSeverity;
};

export type ImportPreviewResult = {
  entity: ImportEntity;
  rows: ImportPreviewRow[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** Original headers that matched no Core field. Never silently discarded. */
  unknownColumns: string[];
  duplicateGroups: ImportDuplicateGroup[];
  format: ImportFormat;
  /** Per input column: original header and the Core field it was mapped to (null = unknown). */
  columns: { header: string; field: string | null }[];
  counts: { total: number; ok: number; warning: number; error: number };
};

export type ImportParseErrorCode = "empty" | "badJson" | "notArray" | "badRecord" | "noHeaders" | "tooManyRows";

export class ImportParseError extends Error {
  readonly code: ImportParseErrorCode;
  constructor(code: ImportParseErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ImportParseError";
    this.code = code;
  }
}

export const MAX_IMPORT_ROWS = 20000;

export type ParsedTable = {
  format: ImportFormat;
  headers: string[];
  rows: string[][];
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const CSV_DELIMITERS = [",", ";", "\t"] as const;

function detectDelimiter(text: string) {
  const counts = new Map<string, number>(CSV_DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (char === "\n" || char === "\r")) break;
    else if (!inQuotes && counts.has(char)) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let best = ",";
  let bestCount = 0;
  for (const [delimiter, count] of counts) {
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/** RFC-4180-ish CSV tokenizer: quoted cells, doubled quotes, CRLF/LF, auto-detected `,` `;` or tab. */
export function parseCsvRows(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === "") inQuotes = true;
    else if (char === delimiter) endCell();
    else if (char === "\r") {
      if (text[i + 1] === "\n") i += 1;
      endRow();
    } else if (char === "\n") endRow();
    else cell += char;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

function isBlankRow(row: readonly string[]) {
  return row.every((cell) => cell.trim() === "");
}

function jsonCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function padHeaders(headers: string[], width: number) {
  const padded = headers.map((header, index) => (header.trim() === "" ? `column ${index + 1}` : header.trim()));
  for (let index = padded.length; index < width; index += 1) padded.push(`column ${index + 1}`);
  return padded;
}

function tableFromCsv(text: string): ParsedTable {
  const all = parseCsvRows(text).filter((row) => !isBlankRow(row));
  if (all.length === 0) throw new ImportParseError("empty");
  const [headerRow, ...body] = all;
  if (headerRow.every((cell) => cell.trim() === "")) throw new ImportParseError("noHeaders");
  if (body.length > MAX_IMPORT_ROWS) throw new ImportParseError("tooManyRows");
  const width = Math.max(headerRow.length, ...body.map((row) => row.length));
  const headers = padHeaders(headerRow, width);
  const rows = body.map((row) => headers.map((_, index) => (row[index] ?? "").trim()));
  return { format: "csv", headers, rows };
}

function tableFromJson(text: string): ParsedTable {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new ImportParseError("badJson");
  }
  if (!Array.isArray(data)) throw new ImportParseError("notArray");
  if (data.length === 0) throw new ImportParseError("empty");
  if (data.length > MAX_IMPORT_ROWS) throw new ImportParseError("tooManyRows");
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const record of data) {
    if (record === null || typeof record !== "object" || Array.isArray(record)) throw new ImportParseError("badRecord");
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }
  if (headers.length === 0) throw new ImportParseError("noHeaders");
  const rows = data.map((record) => headers.map((header) => jsonCell((record as Record<string, unknown>)[header]).trim()));
  return { format: "json", headers, rows: rows.filter((row) => !isBlankRow(row)) };
}

/** Detects the format from a hint (file name / MIME) or the first non-space character, then parses. */
export function parseImportText(text: string, hint?: string): ParsedTable {
  const lowerHint = (hint ?? "").toLowerCase();
  const first = text.replace(/^\uFEFF/, "").trimStart()[0];
  if (text.trim() === "") throw new ImportParseError("empty");
  if (lowerHint.endsWith(".json") || lowerHint.includes("json") || (!lowerHint.endsWith(".csv") && (first === "[" || first === "{"))) {
    return tableFromJson(text);
  }
  return tableFromCsv(text);
}

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

/** Parses "1 234,50", "1,234.50", "1234.5", "250 MDL". Returns null when no number can be read. */
export function parseImportNumber(raw: string): number | null {
  let text = raw.replace(/[\s\u00A0\u202F]/g, "").replace(/[^\d.,+-]/g, "");
  if (!/\d/.test(text)) return null;
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    text = text.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    text = /^[+-]?\d{1,3}(,\d{3})+$/.test(text) ? text.split(",").join("") : text.replace(",", ".");
  }
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

/** Accepts ISO (`2026-10-30[ T]14:05`) and `30.10.2026[ 14:05]` / `30/10/2026`. Returns a normalised string or null. */
export function parseImportDate(raw: string): string | null {
  const text = raw.trim();
  let year: number;
  let month: number;
  let day: number;
  let time = "";
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::\d{2})?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
    if (match[4] !== undefined) time = `${pad2(Number(match[4]))}:${match[5]}`;
  } else {
    match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[\s,]+(\d{1,2}):(\d{2})(?::\d{2})?)?$/.exec(text);
    if (!match) return null;
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
    if (match[4] !== undefined) time = `${pad2(Number(match[4]))}:${match[5]}`;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  if (time) {
    const [hours, minutes] = time.split(":").map(Number);
    if (hours > 23 || minutes > 59) return null;
  }
  const date = `${year}-${pad2(month)}-${pad2(day)}`;
  return time ? `${date}T${time}` : date;
}

/** Digits-only phone key. Moldovan local `0XXXXXXXX` and `+373…` collapse to the same key. */
export function normalizePhoneKey(raw: string) {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 9 && digits.startsWith("0")) digits = `373${digits.slice(1)}`;
  return digits;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

function normalizeEnum(def: ImportFieldDef, raw: string): string | null {
  const key = raw.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  if (def.enumValues?.includes(key)) return key;
  return def.enumSynonyms?.[key] ?? null;
}

type CellResult = { value: ImportValue; issues: Omit<ImportIssue, "row">[] };

function parseCell(def: ImportFieldDef, raw: string): CellResult {
  const issues: Omit<ImportIssue, "row">[] = [];
  const text = raw.trim();
  if (text === "") {
    if (def.required) issues.push({ severity: "error", code: "required", field: def.key });
    return { value: null, issues };
  }
  switch (def.type) {
    case "number":
    case "integer": {
      const value = parseImportNumber(text);
      if (value === null || (def.type === "integer" && !Number.isInteger(value))) {
        issues.push({ severity: "error", code: "invalidNumber", field: def.key, value: text });
        return { value: null, issues };
      }
      if (def.min !== undefined && value < def.min) {
        issues.push({ severity: "error", code: def.min === 0 ? "negative" : "outOfRange", field: def.key, value: text });
        return { value: null, issues };
      }
      if (def.max !== undefined && value > def.max) {
        issues.push({ severity: "error", code: "outOfRange", field: def.key, value: text });
        return { value: null, issues };
      }
      return { value, issues };
    }
    case "email":
      if (!EMAIL_PATTERN.test(text)) {
        issues.push({ severity: "error", code: "invalidEmail", field: def.key, value: text });
        return { value: null, issues };
      }
      return { value: text.toLowerCase(), issues };
    case "phone":
      if (normalizePhoneKey(text).length < 6) issues.push({ severity: "warning", code: "shortPhone", field: def.key, value: text });
      return { value: text, issues };
    case "date": {
      const value = parseImportDate(text);
      if (!value) {
        issues.push({ severity: "error", code: "invalidDate", field: def.key, value: text });
        return { value: null, issues };
      }
      return { value, issues };
    }
    case "enum": {
      const value = normalizeEnum(def, text);
      if (!value) {
        issues.push({ severity: "warning", code: "invalidEnum", field: def.key, value: text });
        return { value: null, issues };
      }
      return { value, issues };
    }
    default:
      return { value: text, issues };
  }
}

// ---------------------------------------------------------------------------
// Entity post-processing, relationships and duplicates
// ---------------------------------------------------------------------------

function splitMakeModel(text: string) {
  const [make, ...rest] = text.trim().split(/\s+/);
  return { make: make ?? "", model: rest.join(" ") };
}

/** Entity-specific derived values and soft checks. Mutates `values`; returns extra issues. */
function finalizeRow(entity: ImportEntity, values: Record<string, ImportValue>): Omit<ImportIssue, "row">[] {
  const issues: Omit<ImportIssue, "row">[] = [];
  const str = (key: string) => (typeof values[key] === "string" ? (values[key] as string) : "");

  if (entity === "vehicles" || entity === "orders") {
    if (str("license_plate")) values.license_plate = str("license_plate").toUpperCase();
    if (str("vin")) {
      values.vin = str("vin").replace(/\s+/g, "").toUpperCase();
      if (!VIN_PATTERN.test(str("vin"))) issues.push({ severity: "warning", code: "invalidVin", field: "vin", value: str("vin") });
    }
  }

  if (entity === "vehicles") {
    const combined = str("make_model");
    if (combined) {
      // Doc §7: split Make/Model, keep the original text in notes.
      const parts = splitMakeModel(combined);
      if (!str("make")) values.make = parts.make;
      if (!str("model")) values.model = parts.model || null;
      values.notes = combined;
    }
    delete values.make_model;
    // Doc §7: a contact without any vehicle fields gets no vehicle record.
    if (!str("make") && !str("model") && !str("vin") && !str("license_plate")) {
      issues.push({ severity: "warning", code: "noVehicleData" });
    }
  }

  if (entity === "vehicles" || entity === "orders") {
    if (!str("client_key")) {
      // Vehicles already get a required-field error; for orders the hint is a warning (Core allows client-less drafts).
      if (entity === "orders") issues.push({ severity: "warning", code: "missingClientKey", field: "client_key" });
    }
  }
  return issues;
}

type DuplicateRule = { field: string; severity: ImportSeverity; key: (value: ImportValue) => string };

const lowerKey = (value: ImportValue) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const plateKey = (value: ImportValue) => String(value ?? "").toUpperCase().replace(/[\s-]+/g, "");

const duplicateRules: Readonly<Record<ImportEntity, readonly DuplicateRule[]>> = {
  clients: [
    { field: "source_id", severity: "error", key: lowerKey },
    { field: "phone", severity: "warning", key: (value) => normalizePhoneKey(String(value ?? "")) },
    { field: "email", severity: "warning", key: lowerKey },
  ],
  vehicles: [
    { field: "source_id", severity: "error", key: lowerKey },
    { field: "vin", severity: "warning", key: plateKey },
    { field: "license_plate", severity: "warning", key: plateKey },
  ],
  services: [
    { field: "source_id", severity: "error", key: lowerKey },
    { field: "name", severity: "warning", key: lowerKey },
  ],
  inventory_items: [
    { field: "source_id", severity: "error", key: lowerKey },
    { field: "sku", severity: "warning", key: lowerKey },
    { field: "name", severity: "warning", key: lowerKey },
  ],
  orders: [
    { field: "source_id", severity: "error", key: lowerKey },
    // orders.legacy_number has a unique index in crm_ro_v1, so a repeat would fail the import.
    { field: "legacy_number", severity: "error", key: lowerKey },
  ],
};

/** Finds repeated keys inside the file. Phone/email/VIN/plate/name/sku repeats are soft (warnings). */
export function findDuplicateGroups(entity: ImportEntity, rows: readonly Pick<ImportPreviewRow, "row" | "values">[]) {
  const groups: ImportDuplicateGroup[] = [];
  for (const rule of duplicateRules[entity]) {
    const byKey = new Map<string, number[]>();
    for (const row of rows) {
      const raw = row.values[rule.field];
      if (raw === null || raw === undefined || raw === "") continue;
      const key = rule.key(raw);
      if (!key) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), row.row]);
    }
    for (const [key, rowNumbers] of byKey) {
      if (rowNumbers.length > 1) groups.push({ field: rule.field, key, rows: rowNumbers, severity: rule.severity });
    }
  }
  return groups;
}

function rowStatus(issues: readonly ImportIssue[]): ImportRowStatus {
  if (issues.some((issue) => issue.severity === "error")) return "error";
  return issues.length > 0 ? "warning" : "ok";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Builds the dry-run preview from an already parsed table. Never throws for data problems; they become issues. */
export function buildImportPreviewFromTable(entity: ImportEntity, table: ParsedTable): ImportPreviewResult {
  const mapping = mapImportHeaders(entity, table.headers);
  const defs = new Map(importFieldDefs[entity].map((def) => [def.key, def]));
  const fileIssues: ImportIssue[] = [];

  for (const key of mapping.missingRequired) {
    fileIssues.push({ row: 0, severity: "error", code: "missingRequiredColumn", field: key });
  }
  for (const header of mapping.duplicateMappings) {
    fileIssues.push({ row: 0, severity: "warning", code: "duplicateColumn", field: header });
  }
  const hasClientColumn = mapping.fields.includes("client_key");
  if (entity === "orders" && !hasClientColumn) {
    fileIssues.push({ row: 0, severity: "error", code: "missingClientColumn", field: "client_key" });
  }

  const rows: ImportPreviewRow[] = table.rows.map((cells, index) => {
    const rowNumber = index + 1;
    const values: Record<string, ImportValue> = {};
    const extra: Record<string, string> = {};
    const issues: ImportIssue[] = [];

    // Every known field starts as null so the preview table shape is stable.
    for (const def of importFieldDefs[entity]) values[def.key] = null;

    mapping.fields.forEach((fieldKey, column) => {
      const cell = cells[column] ?? "";
      if (!fieldKey) {
        if (cell.trim() !== "") extra[table.headers[column]] = cell;
        return;
      }
      const def = defs.get(fieldKey);
      if (!def) return;
      const result = parseCell(def, cell);
      values[fieldKey] = result.value;
      issues.push(...result.issues.map((issue) => ({ ...issue, row: rowNumber })));
    });

    // Required fields whose column is absent are reported once at file level, not on every row.
    const mappedKeys = new Set(mapping.fields.filter((key): key is string => key !== null));
    const rowIssues = issues.filter((issue) => !(issue.code === "required" && issue.field && !mappedKeys.has(issue.field)));
    for (const issue of finalizeRow(entity, values)) rowIssues.push({ ...issue, row: rowNumber });

    return { row: rowNumber, values, extra, status: rowStatus(rowIssues), issues: rowIssues };
  });

  const duplicateGroups = findDuplicateGroups(entity, rows);
  for (const group of duplicateGroups) {
    // Hard duplicates flag every row after the first; soft ones flag every row in the group.
    const flagged = group.severity === "error" ? group.rows.slice(1) : group.rows;
    for (const rowNumber of flagged) {
      const row = rows[rowNumber - 1];
      const issue: ImportIssue = {
        row: rowNumber,
        severity: group.severity,
        code: group.severity === "error" ? "duplicateKey" : "duplicateSoft",
        field: group.field,
        value: group.key,
        count: group.rows.length,
      };
      row.issues.push(issue);
      row.status = rowStatus(row.issues);
    }
  }

  const rowIssues = rows.flatMap((row) => row.issues);
  const all = [...fileIssues, ...rowIssues];
  const counts = {
    total: rows.length,
    ok: rows.filter((row) => row.status === "ok").length,
    warning: rows.filter((row) => row.status === "warning").length,
    error: rows.filter((row) => row.status === "error").length,
  };

  return {
    entity,
    rows,
    errors: all.filter((issue) => issue.severity === "error"),
    warnings: all.filter((issue) => issue.severity === "warning"),
    unknownColumns: mapping.unknownColumns,
    duplicateGroups,
    format: table.format,
    columns: table.headers.map((header, index) => ({ header, field: mapping.fields[index] })),
    counts,
  };
}

/**
 * Parses CSV or JSON-array text and builds the dry-run preview. Throws `ImportParseError` only when the file cannot
 * be read as a table at all; row-level problems are returned as errors/warnings.
 */
export function buildImportPreview(entity: ImportEntity, text: string, hint?: string): ImportPreviewResult {
  return buildImportPreviewFromTable(entity, parseImportText(text, hint));
}

// ---------------------------------------------------------------------------
// Apply path (blocked)
// ---------------------------------------------------------------------------

export type ImportApplyBlocker = "noSandboxRpc" | "ownerOnly" | "noValidRows" | "hasErrors";

/**
 * Apply is NOT available in this build. Writing needs, all at once:
 *  - the owner running it on the TEST project first (docs §7 "Сначала песочница"),
 *  - a SECURITY DEFINER import RPC that is idempotent through `migration_id_map` + `raw_ro_records` and has no side
 *    effects (no notifications, no stock movements) — no such RPC exists in supabase/manual yet,
 *  - `migration_id_map` being applied (it is closed to the browser by RLS, so only that RPC may write it).
 * `noSandboxRpc` and `ownerOnly` are therefore always reported; the data blockers are informational.
 */
export function importApplyBlockers(result: ImportPreviewResult | null): ImportApplyBlocker[] {
  const blockers: ImportApplyBlocker[] = ["noSandboxRpc", "ownerOnly"];
  if (!result || result.counts.total === 0) blockers.push("noValidRows");
  else if (result.errors.length > 0) blockers.push("hasErrors");
  return blockers;
}

export const IMPORT_APPLY_AVAILABLE = false as const;
