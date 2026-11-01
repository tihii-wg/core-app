import { describe, expect, it } from "vitest";
import { mapImportHeaders, normalizeHeader } from "./importMapping";
import {
  ImportParseError,
  buildImportPreview,
  importApplyBlockers,
  normalizePhoneKey,
  parseCsvRows,
  parseImportDate,
  parseImportNumber,
  parseImportText,
} from "./importPreview";

describe("CSV / JSON parsing", () => {
  it("parses quoted cells, doubled quotes, embedded newlines and CRLF", () => {
    const rows = parseCsvRows('name,note\r\n"Ion, SRL","say ""hi"""\r\n"multi\nline",x\r\n');
    expect(rows).toEqual([
      ["name", "note"],
      ["Ion, SRL", 'say "hi"'],
      ["multi\nline", "x"],
    ]);
  });

  it("auto-detects semicolon and tab delimiters and strips the BOM", () => {
    expect(parseCsvRows("\uFEFFa;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsvRows("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("skips blank lines and keeps extra cells under generated headers", () => {
    const table = parseImportText("Имя контакта,Телефон\n\nИон,069111222,лишнее\n", "clients.csv");
    expect(table.format).toBe("csv");
    expect(table.headers).toEqual(["Имя контакта", "Телефон", "column 3"]);
    expect(table.rows).toEqual([["Ион", "069111222", "лишнее"]]);
  });

  it("parses a JSON array of objects into the same table shape, joining keys across records", () => {
    const table = parseImportText(JSON.stringify([{ name: "A", phone: 123456 }, { name: "B", extra: { x: 1 } }]), "clients.json");
    expect(table.format).toBe("json");
    expect(table.headers).toEqual(["name", "phone", "extra"]);
    expect(table.rows).toEqual([
      ["A", "123456", ""],
      ["B", "", '{"x":1}'],
    ]);
  });

  it("detects JSON without a file name and rejects non-array or invalid JSON", () => {
    expect(parseImportText('[{"name":"A"}]').format).toBe("json");
    const codeOf = (text: string, hint?: string) => {
      try {
        parseImportText(text, hint);
      } catch (error) {
        return error instanceof ImportParseError ? error.code : "other";
      }
      return "none";
    };
    expect(codeOf('{"name":"A"}', "x.json")).toBe("notArray");
    expect(codeOf("[1,2]", "x.json")).toBe("badRecord");
    expect(codeOf("[{", "x.json")).toBe("badJson");
    expect(codeOf("   ")).toBe("empty");
  });
});

describe("value parsing", () => {
  it("reads numbers with spaces, comma decimals and currency text", () => {
    expect(parseImportNumber("1 234,50")).toBe(1234.5);
    expect(parseImportNumber("1,234.50")).toBe(1234.5);
    expect(parseImportNumber("1,234")).toBe(1234);
    expect(parseImportNumber("250 MDL")).toBe(250);
    expect(parseImportNumber("12,5")).toBe(12.5);
    expect(parseImportNumber("abc")).toBeNull();
    expect(parseImportNumber("1.2.3")).toBeNull();
  });

  it("reads ISO and dd.mm.yyyy dates and rejects impossible ones", () => {
    expect(parseImportDate("2026-10-30")).toBe("2026-10-30");
    expect(parseImportDate("30.10.2026 9:05")).toBe("2026-10-30T09:05");
    expect(parseImportDate("2026-10-30T14:05:00Z")).toBe("2026-10-30T14:05");
    expect(parseImportDate("31.02.2026")).toBeNull();
    expect(parseImportDate("soon")).toBeNull();
  });

  it("collapses Moldovan phone spellings to one key", () => {
    expect(normalizePhoneKey("069 111 222")).toBe(normalizePhoneKey("+373 69 111 222"));
  });
});

describe("header mapping and unknown columns", () => {
  it("maps RO-style Russian headers and normalises case, asterisks and punctuation", () => {
    expect(normalizeHeader("Имя контакта*")).toBe("имя контакта");
    const mapping = mapImportHeaders("clients", ["Имя контакта*", "Телефон", "E-mail", "Доверенное лицо", "IDNO"]);
    expect(mapping.fields).toEqual(["name", "phone", "email", "contact_person", "tax_id"]);
    expect(mapping.unknownColumns).toEqual([]);
    expect(mapping.missingRequired).toEqual([]);
  });

  it("collects unknown columns instead of discarding them and reports missing required columns", () => {
    const mapping = mapImportHeaders("clients", ["Телефон", "Рекламная кампания", "День рождения"]);
    expect(mapping.unknownColumns).toEqual(["Рекламная кампания", "День рождения"]);
    expect(mapping.missingRequired).toEqual(["name"]);
  });

  it("treats a second column for an already-mapped field as unknown", () => {
    const mapping = mapImportHeaders("clients", ["Имя", "Название"]);
    expect(mapping.fields).toEqual(["name", null]);
    expect(mapping.unknownColumns).toEqual(["Название"]);
    expect(mapping.duplicateMappings).toEqual(["Название"]);
  });

  it("keeps unknown column values per row in `extra` and lists the columns in the report", () => {
    const result = buildImportPreview(
      "clients",
      "Имя контакта,Телефон,Рекламная кампания\nИон,069111222,Instagram\nМария,069333444,\n",
      "clients.csv",
    );
    expect(result.unknownColumns).toEqual(["Рекламная кампания"]);
    expect(result.rows[0].extra).toEqual({ "Рекламная кампания": "Instagram" });
    expect(result.rows[1].extra).toEqual({});
    expect(result.columns.map((column) => column.field)).toEqual(["name", "phone", null]);
  });
});

describe("validation", () => {
  it("reports required, email, number and date errors per row without throwing", () => {
    const result = buildImportPreview(
      "orders",
      "Номер,Клиент,Сумма,Срок\nA1,Ион,100,30.10.2026\n,Ион,x,2026-13-40\nA3,Мария,-5,\n",
      "orders.csv",
    );
    const codes = result.errors.map((issue) => `${issue.row}:${issue.field}:${issue.code}`);
    expect(codes).toContain("2:legacy_number:required");
    expect(codes).toContain("2:total:invalidNumber");
    expect(codes).toContain("2:deadline:invalidDate");
    expect(codes).toContain("3:total:negative");
    expect(result.rows.map((row) => row.status)).toEqual(["ok", "error", "error"]);
    expect(result.counts).toEqual({ total: 3, ok: 1, warning: 0, error: 2 });
  });

  it("rejects invalid emails and warns on short phones and unknown enum text", () => {
    const result = buildImportPreview("clients", "Имя,Email,Телефон,Тип\nИон,not-an-email,123,Космонавт\n", "c.csv");
    const issues = result.rows[0].issues.map((issue) => `${issue.severity}:${issue.code}`);
    expect(issues).toEqual(expect.arrayContaining(["error:invalidEmail", "warning:shortPhone", "warning:invalidEnum"]));
    expect(result.rows[0].values.email).toBeNull();
  });

  it("maps client type synonyms", () => {
    const result = buildImportPreview("clients", "Имя,Тип\nA,Человек\nB,Организация\n", "c.csv");
    expect(result.rows.map((row) => row.values.client_type)).toEqual(["individual", "organization"]);
  });

  it("reports a missing required column once at file level, not per row", () => {
    const result = buildImportPreview("clients", "Телефон\n069111222\n069333444\n", "c.csv");
    const fileLevel = result.errors.filter((issue) => issue.row === 0);
    expect(fileLevel).toEqual([expect.objectContaining({ code: "missingRequiredColumn", field: "name" })]);
    expect(result.rows.every((row) => row.issues.every((issue) => issue.code !== "required"))).toBe(true);
  });

  it("gives vehicles a client-key requirement, splits make/model, uppercases plates and VINs, keeps the source text", () => {
    const result = buildImportPreview(
      "vehicles",
      "Имя контакта,Машина,Гос номер,Вин номер,Год выпуска\nИон,Toyota Land Cruiser,abc 123,jtmhv05j604123456,2012\n,,,,2010\n",
      "v.csv",
    );
    const [first, second] = result.rows;
    expect(first.values).toMatchObject({
      client_key: "Ион",
      make: "Toyota",
      model: "Land Cruiser",
      notes: "Toyota Land Cruiser",
      license_plate: "ABC 123",
      vin: "JTMHV05J604123456",
      year: 2012,
    });
    expect(first.status).toBe("ok");
    expect(second.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["required", "noVehicleData"]));
  });

  it("flags a short VIN softly", () => {
    const result = buildImportPreview("vehicles", "Клиент,VIN\nИон,ABC123\n", "v.csv");
    expect(result.rows[0].issues).toEqual([expect.objectContaining({ code: "invalidVin", severity: "warning" })]);
  });

  it("needs a client key for orders: missing column is an error, an empty cell is a warning", () => {
    const noColumn = buildImportPreview("orders", "Номер\nA1\n", "o.csv");
    expect(noColumn.errors).toEqual([expect.objectContaining({ row: 0, code: "missingClientColumn" })]);

    const emptyCell = buildImportPreview("orders", "Номер,Клиент\nA1,\n", "o.csv");
    expect(emptyCell.errors).toEqual([]);
    expect(emptyCell.warnings).toEqual([expect.objectContaining({ row: 1, code: "missingClientKey" })]);
  });

  it("reads inventory quantities and prices from JSON", () => {
    const result = buildImportPreview(
      "inventory_items",
      JSON.stringify([{ Название: "Фильтр", SKU: "F-1", Остаток: "12,5", "Цена": "1 200 MDL", Штрихкод: "123" }]),
      "items.json",
    );
    expect(result.rows[0].values).toMatchObject({ name: "Фильтр", sku: "F-1", quantity: 12.5, price: 1200 });
    expect(result.unknownColumns).toEqual(["Штрихкод"]);
  });
});

describe("duplicate detection (within the file)", () => {
  it("groups clients that share a phone or email as soft warnings, never errors", () => {
    const result = buildImportPreview(
      "clients",
      "Имя контакта,Телефон,Email\nАвто 1,069 111 222,fleet@x.md\nАвто 2,+373 69 111 222,FLEET@x.md\nМария,069333444,m@x.md\n",
      "c.csv",
    );
    const fields = result.duplicateGroups.map((group) => `${group.field}:${group.rows.join(",")}:${group.severity}`);
    expect(fields).toEqual(["phone:1,2:warning", "email:1,2:warning"]);
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.status)).toEqual(["warning", "warning", "ok"]);
    expect(result.warnings.filter((issue) => issue.code === "duplicateSoft")).toHaveLength(4);
  });

  it("groups repeated VINs and plates for vehicles", () => {
    const result = buildImportPreview(
      "vehicles",
      "Клиент,Гос номер,Вин номер\nA,AB 123,JTMHV05J604123456\nB,ab-123,JTMHV05J604123456\nC,CD 456,\n",
      "v.csv",
    );
    expect(result.duplicateGroups.map((group) => group.field)).toEqual(["vin", "license_plate"]);
    expect(result.duplicateGroups.every((group) => group.rows.join() === "1,2")).toBe(true);
  });

  it("treats a repeated order number or source id as an error on the later rows only", () => {
    const result = buildImportPreview("orders", "Номер,Клиент\nA1,Ион\nA1,Мария\nA2,Ион\n", "o.csv");
    expect(result.duplicateGroups).toEqual([{ field: "legacy_number", key: "a1", rows: [1, 2], severity: "error" }]);
    expect(result.rows.map((row) => row.status)).toEqual(["ok", "error", "ok"]);
    expect(result.errors).toEqual([expect.objectContaining({ row: 2, code: "duplicateKey" })]);
  });
});

describe("apply path", () => {
  it("is always blocked: no sandbox RPC and owner-only, even for a clean file", () => {
    const clean = buildImportPreview("clients", "Имя\nИон\n", "c.csv");
    expect(importApplyBlockers(clean)).toEqual(expect.arrayContaining(["noSandboxRpc", "ownerOnly"]));
    expect(importApplyBlockers(clean)).not.toContain("hasErrors");
    expect(importApplyBlockers(null)).toContain("noValidRows");
  });
});
