import i18n from "../../i18n";
import type { Industry } from "../../lib/types";

const translatedSlugs = ["auto_repair", "phone_electronics_repair", "computer_repair", "appliance_repair", "equipment_repair", "electrical_services", "home_services", "other"] as const;

type TranslatedSlug = (typeof translatedSlugs)[number];

function isTranslatedSlug(slug: string | null | undefined): slug is TranslatedSlug {
  return (translatedSlugs as readonly string[]).includes(slug ?? "");
}

/** Industry names come from the database; known slugs are shown in the UI language, others as stored. */
export function industryName(industry: Pick<Industry, "name" | "slug">) {
  if (!isTranslatedSlug(industry.slug)) return industry.name;
  return i18n.t(`workspaces.industries.${industry.slug}`, { defaultValue: industry.name });
}
