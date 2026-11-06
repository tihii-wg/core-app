/** Tiny hex helper shared by layout + colorRef (avoids circular imports). */

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isSafeHexColor(value: string): boolean {
  return HEX_COLOR.test(value.trim());
}
