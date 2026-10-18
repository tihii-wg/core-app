import type { Industry } from "../lib/types";
import i18n from "../i18n";
import supabase from "./supabase";

/** A PostgREST/Postgres error (e.g. 42501 permission denied); retrying will not change the answer. */
export class IndustriesQueryError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "IndustriesQueryError";
    this.code = code;
  }
}

export async function getIndustries() {
  const { data, error } = await supabase
    .from("industries")
    .select("id, name, slug, description, is_active, created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) throw new IndustriesQueryError(error.message, error.code);

  return (data ?? []) as Industry[];
}

const industryIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveIndustryId(industryId: string) {
  if (industryIdPattern.test(industryId)) {
    const { data, error } = await supabase.from("industries").select("id").eq("id", industryId).maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.id) return data.id;
  }

  const { data, error } = await supabase.from("industries").select("id").eq("slug", industryId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error(i18n.t("workspaces.errors.industryNotFound"));

  return data.id;
}
