import type { Industry } from "../lib/types";
import i18n from "../i18n";
import supabase from "./supabase";

const industryCatalog: Array<Pick<Industry, "name" | "slug">> = [
  { name: "Auto Repair & Service", slug: "auto_repair" },
  { name: "Phone & Electronics Repair", slug: "phone_electronics_repair" },
  { name: "Computer Repair", slug: "computer_repair" },
  { name: "Appliance Repair", slug: "appliance_repair" },
  { name: "Equipment Repair", slug: "equipment_repair" },
  { name: "Electrical Services", slug: "electrical_services" },
  { name: "Home Services", slug: "home_services" },
  { name: "Other", slug: "other" },
];

export function getIndustryCatalog(): Industry[] {
  return industryCatalog.map((industry) => ({
    id: industry.slug,
    name: industry.name,
    slug: industry.slug,
    description: null,
    is_active: true,
    created_at: "",
  }));
}

export async function getIndustries() {
  const { data, error } = await supabase
    .from("industries")
    .select("id, name, slug, description, is_active, created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

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
