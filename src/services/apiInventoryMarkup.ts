import supabase from "./supabase";

const storageKey = (workspaceId: string) => `inventory-markup:${workspaceId}`;

function isMissingMarkupColumn(error: { code?: string; message?: string }) {
  return error.code === "42703" || error.message?.includes("inventory_markup_percent") === true;
}

function readStoredMarkup(workspaceId: string) {
  const stored = localStorage.getItem(storageKey(workspaceId));
  if (stored == null) return 0;
  const markup = Number(stored);
  return Number.isFinite(markup) && markup >= 0 ? markup : 0;
}

function writeStoredMarkup(workspaceId: string, markupPercent: number) {
  localStorage.setItem(storageKey(workspaceId), String(markupPercent));
}

export async function getInventoryMarkup(workspaceId: string) {
  const { data, error } = await supabase.from("workspaces").select("inventory_markup_percent").eq("id", workspaceId).maybeSingle();

  if (error && isMissingMarkupColumn(error)) return readStoredMarkup(workspaceId);
  if (error) throw new Error(error.message);
  if (!data || data.inventory_markup_percent == null) return readStoredMarkup(workspaceId);

  const markup = Number(data.inventory_markup_percent);
  return Number.isFinite(markup) && markup >= 0 ? markup : 0;
}

export async function updateInventoryMarkup(workspaceId: string, markupPercent: number) {
  if (!Number.isFinite(markupPercent) || markupPercent < 0) throw new Error("Markup percentage cannot be negative");

  const { data, error } = await supabase.from("workspaces").update({ inventory_markup_percent: markupPercent }).eq("id", workspaceId).select("inventory_markup_percent").maybeSingle();

  if (error && isMissingMarkupColumn(error)) {
    writeStoredMarkup(workspaceId, markupPercent);
    return markupPercent;
  }

  if (error) throw new Error(error.message);

  if (!data) {
    writeStoredMarkup(workspaceId, markupPercent);
    return markupPercent;
  }

  const saved = Number(data.inventory_markup_percent);
  const markup = Number.isFinite(saved) ? saved : markupPercent;
  writeStoredMarkup(workspaceId, markup);
  return markup;
}
