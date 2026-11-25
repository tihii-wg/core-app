import i18n from "../i18n";
import supabase from "./supabase";

function isMissingProblemColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (error.code === "42703" || error.code === "PGRST204") && /is_problem/.test(error.message ?? "");
}

export class ProblemClientsUnavailableError extends Error {}

/** Batch size of one `id=in.(…)` request (URL length). */
const CHUNK = 150;

/**
 * Problem flags for the given clients only (SQL 20261125224000_problem_clients): the clients shown on
 * the current page, not every client of the workspace. All false before the SQL is applied.
 */
export async function getProblemFlags(workspaceId: string, clientIds: string[]): Promise<Map<string, boolean>> {
  const ids = [...new Set(clientIds.filter(Boolean))];
  const result = new Map<string, boolean>(ids.map((id) => [id, false]));
  if (ids.length === 0) return result;
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += CHUNK) chunks.push(ids.slice(index, index + CHUNK));
  const parts = await Promise.all(
    chunks.map((chunk) =>
      supabase.from("clients").select("id").eq("workspace_id", workspaceId).eq("is_problem", true).in("id", chunk),
    ),
  );
  for (const { data, error } of parts) {
    if (error) {
      if (isMissingProblemColumn(error)) return result;
      throw new Error(error.message);
    }
    for (const row of data ?? []) result.set(String((row as { id: unknown }).id), true);
  }
  return result;
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
