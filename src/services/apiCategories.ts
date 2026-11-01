import i18n from "../i18n";
import { isMissingTableError } from "./apiWarehouses";
import supabase from "./supabase";

export type CategoryScope = "service" | "product" | "bundle";

export type CategoryRecord = {
  id: string;
  workspaceId: string;
  scope: CategoryScope;
  parentId: string | null;
  name: string;
  sortOrder: number;
};

export type CategoriesResult = {
  /** False when the `categories` table is not applied yet (Appendix A). */
  available: boolean;
  categories: CategoryRecord[];
};

const categoryColumns = "id, workspace_id, scope, parent_id, name, sort_order, deleted_at";

function requireWorkspaceId(workspaceId: string | undefined) {
  const id = workspaceId?.trim() ?? "";
  if (!id) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return id;
}

export function toCategory(row: Record<string, unknown>): CategoryRecord {
  const scope = row.scope === "service" || row.scope === "bundle" ? row.scope : "product";
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    scope,
    parentId: row.parent_id ? String(row.parent_id) : null,
    name: typeof row.name === "string" ? row.name : "",
    sortOrder: Number(row.sort_order ?? 0),
  };
}

/** Lists categories (optionally one scope); `available: false` when the table is missing. */
export async function getCategories(workspaceId: string | undefined, scope?: CategoryScope): Promise<CategoriesResult> {
  const resolved = requireWorkspaceId(workspaceId);
  let query = supabase
    .from("categories")
    .select(categoryColumns)
    .eq("workspace_id", resolved)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (scope) query = query.eq("scope", scope);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return { available: false, categories: [] };
    throw new Error(error.message);
  }
  return { available: true, categories: ((data ?? []) as Record<string, unknown>[]).map(toCategory) };
}
