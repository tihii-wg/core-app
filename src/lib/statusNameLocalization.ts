import i18n, { resources } from "../i18n";

/**
 * Built-in status names follow the interface language.
 *
 * Workspaces get their starting statuses from seeds (server: "New", "In Progress", "Waiting for Parts"…; the
 * industry presets and the CRM seed in Russian / English). Those rows store a plain name, so a Russian interface
 * showed "Waiting for Parts". A stored name that is exactly one of these built-in names (in any interface
 * language) is shown in the current language; a name the user typed himself is shown as typed.
 */

type Resources = typeof resources;
type Tree = Record<string, unknown>;

/** i18n keys of every built-in status name (order of priority when two keys share a source text). */
const STATUS_NAME_KEY_GROUPS: readonly { base: string; keys?: readonly string[] }[] = [
  { base: "status.order", keys: ["new", "in-progress", "waiting-parts", "completed", "paid", "cancelled", "closed"] },
  { base: "industries.statuses.auto" },
  { base: "industries.statuses.device" },
  { base: "industries.statuses.site" },
  { base: "industries.statuses.furniture" },
  { base: "industries.statuses.other" },
  { base: "statusNames.order" },
  { base: "statusNames.estimate" },
  { base: "statusNames.lead" },
  { base: "statusNames.invoice" },
  { base: "statusNames.transfer" },
  { base: "statusNames.task" },
];

function normalize(name: string) {
  return name.trim().toLocaleLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

function subtree(root: Tree, path: string): Tree | null {
  let node: unknown = root;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return null;
    node = (node as Tree)[part];
  }
  return node && typeof node === "object" ? (node as Tree) : null;
}

let index: Map<string, string> | null = null;

/** normalized built-in name (any language) → i18n key. */
function nameIndex() {
  if (index) return index;
  index = new Map();
  for (const language of Object.keys(resources) as (keyof Resources)[]) {
    const root = resources[language].translation as unknown as Tree;
    for (const group of STATUS_NAME_KEY_GROUPS) {
      const node = subtree(root, group.base);
      if (!node) continue;
      for (const key of group.keys ?? Object.keys(node)) {
        const value = node[key];
        if (typeof value !== "string" || !value.trim()) continue;
        const normalized = normalize(value);
        if (!index.has(normalized)) index.set(normalized, `${group.base}.${key}`);
      }
    }
  }
  return index;
}

/** The status name to show: built-in names in the interface language, custom names unchanged. */
export function localizeStatusName(name: string): string {
  if (!name) return name;
  const key = nameIndex().get(normalize(name));
  if (!key) return name;
  const translated = i18n.t(key as never, { defaultValue: name }) as unknown as string;
  return typeof translated === "string" && translated.trim() ? translated : name;
}

export function localizeCustomStatus<T extends { name: string } | null | undefined>(status: T): T {
  if (!status) return status;
  const name = localizeStatusName(status.name);
  return name === status.name ? status : ({ ...status, name } as T);
}
