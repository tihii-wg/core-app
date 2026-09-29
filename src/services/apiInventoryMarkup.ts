import supabase from "./supabase";

const maxInventoryMarkup = 1000;

export async function getInventoryMarkup(workspaceId: string) {
  const { data, error } = await supabase.from("workspaces").select("inventory_markup").eq("id", workspaceId).maybeSingle();

  if (error) throw new Error(error.message);
  return normalizeInventoryMarkup(data?.inventory_markup);
}

export async function updateInventoryMarkup(workspaceId: string, markupPercent: number) {
  assertInventoryMarkup(markupPercent);

  const { data, error } = await supabase.from("workspaces").update({ inventory_markup: markupPercent }).eq("id", workspaceId).select("inventory_markup").maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Only the workspace owner can change the markup percentage.");

  return normalizeInventoryMarkup(data.inventory_markup);
}

export function assertInventoryMarkup(markupPercent: number) {
  if (!Number.isFinite(markupPercent)) throw new Error("Markup percentage must be a number");
  if (markupPercent < 0) throw new Error("Markup percentage cannot be negative");
  if (markupPercent > maxInventoryMarkup) throw new Error("Markup percentage cannot be greater than 1000");
}

function normalizeInventoryMarkup(value: unknown) {
  if (value == null || value === "") return 0;
  const markup = Number(value);
  return Number.isFinite(markup) && markup >= 0 ? markup : 0;
}
