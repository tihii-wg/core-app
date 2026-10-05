import i18n from "../i18n";
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
  if (!data) throw new Error(i18n.t("inventory.markup.ownerOnly"));

  return normalizeInventoryMarkup(data.inventory_markup);
}

export function assertInventoryMarkup(markupPercent: number) {
  if (!Number.isFinite(markupPercent)) throw new Error(i18n.t("inventory.markup.notNumber"));
  if (markupPercent < 0) throw new Error(i18n.t("inventory.markup.negative"));
  if (markupPercent > maxInventoryMarkup) throw new Error(i18n.t("inventory.markup.tooHigh", { max: maxInventoryMarkup }));
}

function normalizeInventoryMarkup(value: unknown) {
  if (value == null || value === "") return 0;
  const markup = Number(value);
  return Number.isFinite(markup) && markup >= 0 ? markup : 0;
}
