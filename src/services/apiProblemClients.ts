import i18n from "../i18n";
import supabase from "./supabase";

function isMissingProblemColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (error.code === "42703" || error.code === "PGRST204") && /is_problem/.test(error.message ?? "");
}

export class ProblemClientsUnavailableError extends Error {}

/**
 * Ids of the workspace's clients flagged as problem clients (SQL 20261125224000_problem_clients).
 * One small request; an empty set before the SQL is applied.
 */
export async function getProblemClientIds(workspaceId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("clients")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("is_problem", true)
    .is("deleted_at", null)
    .limit(5000);
  if (error) {
    if (isMissingProblemColumn(error)) return new Set();
    throw new Error(error.message);
  }
  return new Set((data ?? []).map((row) => String((row as { id: unknown }).id)));
}

export async function setClientProblem(workspaceId: string, clientId: string, isProblem: boolean): Promise<void> {
  const { data, error } = await supabase
    .from("clients")
    .update({ is_problem: isProblem })
    .eq("id", clientId)
    .eq("workspace_id", workspaceId)
    .select("id")
    .maybeSingle();
  if (error) {
    if (isMissingProblemColumn(error)) {
      throw new ProblemClientsUnavailableError(i18n.t("clients.problem.errors.sqlMissing"));
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error(i18n.t("clients.errors.notFoundOrForbidden"));
}
