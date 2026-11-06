/** Helpers to turn on useStyle and replace hard-coded default hex colors with theme refs. */

import { defaultStyleHexByThemeKey, themeRef, type ThemeColorKey } from "./documentStyle";
import type { BlockStyle, DocumentLayout, LayoutBlock } from "./layout";
import { isSafeHexColor } from "./layoutHex";

function hexToTheme(value: string | undefined, defaults: Record<ThemeColorKey, string>): string | undefined {
  if (!value || !isSafeHexColor(value)) return value;
  const normalized = value.trim().toLowerCase();
  for (const key of Object.keys(defaults) as ThemeColorKey[]) {
    if (defaults[key].toLowerCase() === normalized) return themeRef(key);
  }
  return value;
}

function mapStyle(style: BlockStyle | undefined, defaults: Record<ThemeColorKey, string>): BlockStyle | undefined {
  if (!style) return style;
  return {
    ...style,
    background: hexToTheme(style.background, defaults),
    color: hexToTheme(style.color, defaults),
    titleColor: hexToTheme(style.titleColor, defaults),
  };
}

function mapBlock(block: LayoutBlock, defaults: Record<ThemeColorKey, string>): LayoutBlock {
  if (block.kind === "columns") {
    return {
      ...block,
      style: mapStyle(block.style, defaults),
      columns: block.columns.map((column) => ({
        ...column,
        blocks: column.blocks.map((child) => mapBlock(child, defaults)),
      })),
    };
  }
  return { ...block, style: mapStyle(block.style, defaults) } as LayoutBlock;
}

/** Sets useStyle and replaces known default hex colors with theme:* refs. */
export function applyCommonStyleToLayout(layout: DocumentLayout): DocumentLayout {
  const defaults = defaultStyleHexByThemeKey();
  return {
    ...layout,
    version: 2,
    useStyle: true,
    blocks: layout.blocks.map((block) => mapBlock(block, defaults)),
  };
}
