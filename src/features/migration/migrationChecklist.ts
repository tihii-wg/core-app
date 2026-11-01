import type { MigrationPreviewGroup } from "../../services/apiMigrationPreview";

/** Dry-run checklist for the RO App → Core App migration (docs/ro-app-migration.md, Stages 7–8). */
export const migrationChecklistSteps = [
  "backup",
  "applySql",
  "regression",
  "source",
  "sandbox",
  "reconcile",
  "freeze",
  "cutover",
  "readOnly",
] as const;

export type MigrationChecklistStep = (typeof migrationChecklistSteps)[number];

export const migrationPreviewGroups = ["core", "roSchema", "tooling"] as const satisfies readonly MigrationPreviewGroup[];

/** Steps 1–6 happen on the TEST project; 7–9 are the PROD cutover. */
export const migrationProdSteps: readonly MigrationChecklistStep[] = ["freeze", "cutover", "readOnly"];

export function migrationChecklistProgress(done: ReadonlySet<MigrationChecklistStep>) {
  const completed = migrationChecklistSteps.filter((step) => done.has(step)).length;
  return { completed, total: migrationChecklistSteps.length };
}
