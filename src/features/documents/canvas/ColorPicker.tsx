import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { themeRef, type ColorRef, type StyleColorPalette, type ThemeColorKey } from "../colorRef";
import { isCanvasHexColor } from "./fill";
import { CANVAS_COLOR_PRESETS, loadRecentColors, pushRecentColor } from "./colorPresets";
import type { Fill } from "./types";
import { Label } from "../../../ui/Label";
import { Input } from "../../../ui/Input";
import { Button } from "../../../ui/Button";

type ColorPickerProps = {
  label: string;
  value: ColorRef | Fill | null | undefined;
  allowNoFill?: boolean;
  allowOpacity?: boolean;
  themeColors?: StyleColorPalette | null;
  workspaceId?: string;
  disabled?: boolean;
  onChange: (next: ColorRef | Fill | null) => void;
};

const THEME_KEYS: ThemeColorKey[] = ["primary", "primaryDark", "tint", "muted", "text", "border"];

function asFill(value: ColorRef | Fill | null | undefined): Fill | null {
  if (value == null) return null;
  if (typeof value === "string") return { color: value };
  return value;
}

export function ColorPicker({
  label,
  value,
  allowNoFill,
  allowOpacity,
  themeColors,
  workspaceId,
  disabled,
  onChange,
}: ColorPickerProps) {
  const { t } = useTranslation();
  const fill = asFill(value);
  const [hexDraft, setHexDraft] = useState(fill && isCanvasHexColor(fill.color) ? fill.color : "#1a6de0");
  const recent = useMemo(() => loadRecentColors(workspaceId), [workspaceId, fill?.color]);

  function commitColor(color: ColorRef, opacity?: number) {
    if (isCanvasHexColor(color)) {
      pushRecentColor(workspaceId, color.trim());
      setHexDraft(color.trim());
    }
    if (allowOpacity) {
      onChange({ color, ...(opacity != null ? { opacity } : fill?.opacity != null ? { opacity: fill.opacity } : {}) });
    } else {
      onChange(color);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        {allowNoFill ? (
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
            {t("settings.printTemplates.canvas.noFill")}
          </Button>
        ) : null}
      </div>

      {themeColors ? (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">{t("settings.printTemplates.canvas.themeColors")}</p>
          <div className="flex flex-wrap gap-1.5">
            {THEME_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                title={key}
                disabled={disabled}
                className="h-6 w-6 rounded border border-border"
                style={{ background: themeColors[key] }}
                onClick={() => commitColor(themeRef(key))}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-1">
        <div className="flex flex-wrap gap-1.5">
          {CANVAS_COLOR_PRESETS.map((hex) => (
            <button
              key={hex}
              type="button"
              title={hex}
              disabled={disabled}
              className="h-6 w-6 rounded border border-border"
              style={{ background: hex }}
              onClick={() => commitColor(hex)}
            />
          ))}
        </div>
      </div>

      {recent.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">{t("settings.printTemplates.canvas.recentColors")}</p>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((hex) => (
              <button
                key={hex}
                type="button"
                title={hex}
                disabled={disabled}
                className="h-6 w-6 rounded border border-border"
                style={{ background: hex }}
                onClick={() => commitColor(hex)}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Input
          type="color"
          className="h-9 w-12 p-1"
          disabled={disabled}
          value={isCanvasHexColor(hexDraft) ? hexDraft : "#1a6de0"}
          onChange={(event) => commitColor(event.target.value)}
        />
        <Input
          value={hexDraft}
          disabled={disabled}
          placeholder="#rrggbb"
          onChange={(event) => setHexDraft(event.target.value)}
          onBlur={() => {
            if (isCanvasHexColor(hexDraft)) commitColor(hexDraft.trim());
          }}
        />
      </div>

      {allowOpacity ? (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("settings.printTemplates.canvas.opacity")}</Label>
          <input
            type="range"
            min={0}
            max={100}
            disabled={disabled}
            value={Math.round((fill?.opacity ?? 1) * 100)}
            onChange={(event) => {
              const opacity = Number(event.target.value) / 100;
              if (fill) onChange({ color: fill.color, opacity });
            }}
            className="w-full"
          />
        </div>
      ) : null}
    </div>
  );
}
