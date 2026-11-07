import i18n from "../../i18n";
import type { Industry } from "../../lib/types";
import { KNOWN_INDUSTRY_SLUGS, type KnownIndustrySlug } from "./industryProfile";

function isTranslatedSlug(slug: string | null | undefined): slug is KnownIndustrySlug {
  return (KNOWN_INDUSTRY_SLUGS as readonly string[]).includes(slug ?? "");
}

/** Industry names come from the database; known slugs are shown in the UI language, others as stored. */
export function industryName(industry: Pick<Industry, "name" | "slug">) {
  if (!isTranslatedSlug(industry.slug)) return industry.name;
  return i18n.t(`workspaces.industries.${industry.slug}`, { defaultValue: industry.name });
}
