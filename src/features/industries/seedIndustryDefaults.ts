import i18n from "../../i18n";
import {
  createStatusDefinition,
  deleteStatusDefinition,
  getStatusDefinitions,
  isLifecycleOrderStatusDefinition,
  setDefaultStatusDefinition,
  setOrderLifecycleSemantic,
  type StatusDefinition,
} from "../../services/apiStatusDefinitions";
import { createDocumentTemplate, getDocumentTemplates } from "../../services/apiDocumentTemplates";
import { industryProfile, type IndustryProfile } from "./industryProfile";

export type SeedStatusesResult = {
  created: number;
  skipped: number;
  deleted: number;
};

/**
 * Seeds order statuses from the industry profile via the existing status API.
 * When `replace` is true, unused non-lifecycle statuses are soft-deleted first.
 * Lifecycle close/cancel rows are kept and get semantic actions assigned on matching seeds.
 * Never called automatically on industry change — only from explicit UI / empty first setup.
 */
export async function seedIndustryOrderStatuses(
  workspaceId: string | undefined,
  profile: IndustryProfile,
  options: { replace?: boolean } = {},
): Promise<SeedStatusesResult> {
  const existing = await getStatusDefinitions(workspaceId, "order");
  let deleted = 0;

  if (options.replace) {
    for (const status of existing) {
      if (isLifecycleOrderStatusDefinition(status)) continue;
      try {
        await deleteStatusDefinition(status.id, workspaceId);
        deleted += 1;
      } catch {
        // In use or protected — leave it.
      }
    }
  }

  const afterDelete = options.replace ? await getStatusDefinitions(workspaceId, "order") : existing;
  const byName = new Map(afterDelete.map((s) => [s.name.trim().toLowerCase(), s]));

  let created = 0;
  let skipped = 0;
  let sortOrder = afterDelete.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;
  let defaultId: string | null = null;
  const lifecycleTargets: Array<{ id: string; action: "close" | "cancel" }> = [];

  for (const seed of profile.defaultStatuses) {
    const name = String(i18n.t(seed.nameKey as never, { defaultValue: seed.nameKey }));
    const existingMatch = byName.get(name.trim().toLowerCase());
    if (existingMatch) {
      skipped += 1;
      if (seed.semanticAction === "close" || seed.semanticAction === "cancel") {
        lifecycleTargets.push({ id: existingMatch.id, action: seed.semanticAction });
      }
      if (seed.isDefault) defaultId = existingMatch.id;
      continue;
    }

    if (seed.semanticAction === "close" || seed.semanticAction === "cancel") {
      const lifecycle = afterDelete.find((s) => s.semanticAction === seed.semanticAction);
      if (lifecycle) {
        skipped += 1;
        lifecycleTargets.push({ id: lifecycle.id, action: seed.semanticAction });
        continue;
      }
    }

    const createdStatus = await createStatusDefinition(
      {
        entity: "order",
        name,
        color: seed.color,
        statusGroup: seed.statusGroup,
        systemStatus: seed.systemStatus && seed.systemStatus !== "closed" && seed.systemStatus !== "cancelled" ? seed.systemStatus : null,
        sortOrder: sortOrder++,
      },
      workspaceId,
    );
    created += 1;
    byName.set(name.trim().toLowerCase(), createdStatus);
    if (seed.isDefault) defaultId = createdStatus.id;
    if (seed.semanticAction === "close" || seed.semanticAction === "cancel") {
      lifecycleTargets.push({ id: createdStatus.id, action: seed.semanticAction });
    }
  }

  for (const target of lifecycleTargets) {
    try {
      await setOrderLifecycleSemantic(target.id, target.action, workspaceId);
    } catch {
      // RPC may be unavailable in older environments — status still exists as normal.
    }
  }

  if (defaultId) {
    try {
      await setDefaultStatusDefinition(defaultId, workspaceId);
    } catch {
      // ignore when protected/inactive
    }
  }

  return { created, skipped, deleted };
}

/**
 * Creates missing print templates listed on the industry profile (by role name).
 * Does not rename or delete existing templates when the industry changes.
 */
export async function ensureIndustryDocumentTemplates(
  workspaceId: string | undefined,
  profile: IndustryProfile = industryProfile(null),
): Promise<number> {
  const existing = await getDocumentTemplates(workspaceId);
  const names = new Set(existing.map((t) => t.name.trim().toLowerCase()));
  const typesPresent = new Set(existing.map((t) => t.documentType));
  let created = 0;

  for (const spec of profile.documents) {
    const name = String(i18n.t(spec.nameKey as never, { defaultValue: spec.nameKey }));
    if (names.has(name.trim().toLowerCase())) continue;
    // Prefer one default per documentType when the type is still missing entirely.
    const makeDefault = !typesPresent.has(spec.documentType);
    await createDocumentTemplate(spec.documentType, workspaceId, name, { isDefault: makeDefault });
    names.add(name.trim().toLowerCase());
    typesPresent.add(spec.documentType);
    created += 1;
  }

  return created;
}

export function orderStatusesNeedIndustrySeed(statuses: StatusDefinition[]) {
  return statuses.length === 0;
}
