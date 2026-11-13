/** Resolve human-readable labels for template tokens shown on the canvas. */

import type { TFunction } from "i18next";
import {
  TEMPLATE_VARIABLES,
  visibleTemplateVariables,
  type TemplateVariable,
  type VariableGroup,
} from "../templateVariables";

const TOKEN_PATTERN = /#[\wА-Яа-яЁё\-]+|\{\{[^}]+\}\}/g;

export type ResolvedVariableLabel = {
  token: string;
  label: string;
  known: boolean;
  group?: VariableGroup;
};

const byToken = new Map<string, TemplateVariable>();
for (const variable of TEMPLATE_VARIABLES) {
  byToken.set(variable.token, variable);
}

export function resolveVariableLabel(token: string, t: TFunction): ResolvedVariableLabel {
  const trimmed = token.trim();
  const known = byToken.get(trimmed);
  if (known) {
    return {
      token: trimmed,
      label: String(t(known.labelKey as never)),
      known: true,
      group: known.group,
    };
  }
  // Custom order fields: {{order.custom.*}} / {{order.label.*}}
  const custom = trimmed.match(/^\{\{order\.(custom|label)\.([^}]+)\}\}$/);
  if (custom) {
    const key = custom[2];
    return {
      token: trimmed,
      label: key,
      known: true,
      group: "order",
    };
  }
  return { token: trimmed, label: trimmed, known: false };
}

export function groupedVisibleVariables(): Array<{ group: VariableGroup; variables: TemplateVariable[] }> {
  const groups: VariableGroup[] = [
    "order",
    "client",
    "vehicle",
    "company",
    "money",
    "warranty",
    "document",
    "invoice",
    "staff",
    "tables",
  ];
  return groups
    .map((group) => ({
      group,
      variables: visibleTemplateVariables().filter((variable) => variable.group === group),
    }))
    .filter((entry) => entry.variables.length > 0);
}

export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "token"; token: string; label: string; known: boolean };

/** Split free text into plain runs and variable tokens for chip rendering. */
export function segmentTextWithVariables(content: string, t: TFunction): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  const matches = content.matchAll(TOKEN_PATTERN);
  for (const match of matches) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ kind: "text", text: content.slice(last, index) });
    const token = match[0];
    const resolved = resolveVariableLabel(token, t);
    segments.push({ kind: "token", token, label: resolved.label, known: resolved.known });
    last = index + token.length;
  }
  if (last < content.length) segments.push({ kind: "text", text: content.slice(last) });
  if (segments.length === 0) segments.push({ kind: "text", text: content });
  return segments;
}
