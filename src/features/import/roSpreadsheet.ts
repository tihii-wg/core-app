import type { SheetCell } from "./roImportParse";

export type SheetTable = { headers: string[]; rows: SheetCell[][]; sheetName: string };

const MAX_BYTES = 30 * 1024 * 1024;

/**
 * Reads the first sheet of an .xls / .xlsx / .csv file in the browser (SheetJS, loaded only when needed).
 * Values stay raw: RO App dates arrive as Excel serial numbers and are converted by the parser.
 */
export async function readSpreadsheet(file: File): Promise<SheetTable> {
  if (file.size <= 0 || file.size > MAX_BYTES) throw new Error("import:file_size");
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", dense: true, cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("import:empty");
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("import:empty");
  const matrix = XLSX.utils.sheet_to_json<SheetCell[]>(sheet, { header: 1, raw: true, defval: null, blankrows: false });
  const [headerRow, ...rows] = matrix;
  if (!headerRow) throw new Error("import:empty");
  return { headers: headerRow.map((cell) => (cell == null ? "" : String(cell).trim())), rows, sheetName };
}
