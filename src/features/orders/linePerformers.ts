import type { OrderService } from "../../lib/types";

/** All performers of a service line: the main one first, then the extra ones (no duplicates). */
export function linePerformerIds(line: Pick<OrderService, "technicianId" | "extraTechnicianIds">): string[] {
  const ids: string[] = [];
  const main = line.technicianId?.trim();
  if (main) ids.push(main);
  for (const raw of line.extraTechnicianIds ?? []) {
    const id = raw?.trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Display names of all performers of a line (main first); unknown names are skipped. */
export function linePerformerNames(
  line: Pick<OrderService, "technicianName" | "extraTechnicianNames" | "technicianId" | "extraTechnicianIds">,
): string[] {
  const names: string[] = [];
  if (line.technicianId?.trim() && line.technicianName?.trim()) names.push(line.technicianName.trim());
  for (const name of line.extraTechnicianNames ?? []) {
    if (name?.trim()) names.push(name.trim());
  }
  return names;
}

/** Splits an ordered performer list into the stored shape: first = main, rest = extras. */
export function splitLinePerformers(ids: readonly string[]): { technicianId: string | null; extraTechnicianIds: string[] } {
  const clean = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  return { technicianId: clean[0] ?? null, extraTechnicianIds: clean.slice(1) };
}

/** Same set of extra performers (order does not matter). */
export function sameExtraPerformers(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = [...new Set((a ?? []).filter(Boolean))].sort();
  const right = [...new Set((b ?? []).filter(Boolean))].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
