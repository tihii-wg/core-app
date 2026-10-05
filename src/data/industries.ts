import type { IndustryKey } from "../lib/types";

export type Industry = {
  value: IndustryKey;
  labelKey: `workspaces.industryPresets.${IndustryKey}.label`;
  hintKey: `workspaces.industryPresets.${IndustryKey}.hint`;
};

function preset<K extends IndustryKey>(value: K) {
  return {
    value,
    labelKey: `workspaces.industryPresets.${value}.label`,
    hintKey: `workspaces.industryPresets.${value}.hint`,
  } as const;
}

export const industries: Industry[] = [
  preset("restaurant"),
  preset("beauty"),
  preset("fitness"),
  preset("medical"),
  preset("retail"),
  preset("professional_services"),
  preset("auto_service"),
  preset("electronics_repair"),
];
