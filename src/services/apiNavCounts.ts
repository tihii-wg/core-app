import i18n from "../i18n";
import type { AppModule } from "../lib/types";
import supabase from "./supabase";

export type NavCountModule = Extract<AppModule, "orders" | "clients" | "services" | "inventory" | "employees">;

export const NAV_COUNT_MODULES: readonly NavCountModule[] = [
  "orders",
  "clients",
  "services",
  "inventory",
  "employees",
] as const;

function requireWorkspaceId(workspaceId: string | undefined): string {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return workspaceId;
}

async function exactCount(
  run: () => PromiseLike<{ count: number | null; error: { message?: string; code?: string } | null }>,
): Promise<number> {
  const { count, error } = await run();
  if (error) throw new Error(error.message || i18n.t("common.somethingWentWrong"));
  return typeof count === "number" && count >= 0 ? count : 0;
}

/** Total orders in the workspace (same scope as the Orders list with default filters). */
export async function countWorkspaceOrders(workspaceId: string | undefined): Promise<number> {
  const id = requireWorkspaceId(workspaceId);
  return exactCount(() =>
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("workspace_id", id),
  );
}

/** Non-deleted clients in the workspace (matches Clients list default). */
export async function countWorkspaceClients(workspaceId: string | undefined): Promise<number> {
  const id = requireWorkspaceId(workspaceId);
  const primary = await supabase
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", id)
    .is("deleted_at", null);

  if (primary.error && (primary.error.code === "42703" || primary.error.code === "PGRST204") && primary.error.message?.includes("deleted_at")) {
    return exactCount(() =>
      supabase.from("clients").select("id", { count: "exact", head: true }).eq("workspace_id", id),
    );
  }

  if (primary.error) throw new Error(primary.error.message || i18n.t("common.somethingWentWrong"));
  return typeof primary.count === "number" && primary.count >= 0 ? primary.count : 0;
}

/**
 * Active services only — matches the Services page default status filter.
 * Inactive catalogue rows are excluded until the user switches the page filter.
 */
export async function countWorkspaceServices(workspaceId: string | undefined): Promise<number> {
  const id = requireWorkspaceId(workspaceId);
  return exactCount(() =>
    supabase
      .from("services")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", id)
      .eq("status", "active"),
  );
}

/** All inventory items in the workspace (matches Inventory default filter `all`). */
export async function countWorkspaceInventory(workspaceId: string | undefined): Promise<number> {
  const id = requireWorkspaceId(workspaceId);
  return exactCount(() =>
    supabase
      .from("inventory_items_with_status")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", id),
  );
}

/** All employees in the workspace (matches Employees default status filter `all`). */
export async function countWorkspaceEmployees(workspaceId: string | undefined): Promise<number> {
  const id = requireWorkspaceId(workspaceId);
  return exactCount(() =>
    supabase.from("employees").select("id", { count: "exact", head: true }).eq("workspace_id", id),
  );
}

export function navCountQueryKey(module: NavCountModule, workspaceId: string | undefined) {
  // Third segment keeps this under existing entity invalidation prefixes
  // e.g. invalidateQueries({ queryKey: ["orders", workspaceId] }).
  return [module, workspaceId, "nav-count"] as const;
}

export async function countWorkspaceNavModule(
  module: NavCountModule,
  workspaceId: string | undefined,
): Promise<number> {
  switch (module) {
    case "orders":
      return countWorkspaceOrders(workspaceId);
    case "clients":
      return countWorkspaceClients(workspaceId);
    case "services":
      return countWorkspaceServices(workspaceId);
    case "inventory":
      return countWorkspaceInventory(workspaceId);
    case "employees":
      return countWorkspaceEmployees(workspaceId);
  }
}
