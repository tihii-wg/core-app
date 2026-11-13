import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StyleColorPalette } from "../colorRef";
import { ColorPicker } from "./ColorPicker";
import type { CanvasDocumentLayout, CanvasElement, Fill } from "./types";
import { Input } from "../../../ui/Input";
import { Label } from "../../../ui/Label";
import { Button } from "../../../ui/Button";
import { Switch } from "../../../ui/Switch";
import type { ColorRef } from "../colorRef";
import { groupedVisibleVariables, resolveVariableLabel } from "./variableDisplay";

type Props = {
  layout: CanvasDocumentLayout;
  selected: CanvasElement[];
  themeColors?: StyleColorPalette | null;
  workspaceId?: string;
  disabled?: boolean;
  onChangeElements: (updater: (elements: CanvasElement[]) => CanvasElement[]) => void;
  onChangePageBackground: (fill: Fill | null) => void;
};

function updateSelected(
  elements: CanvasElement[],
  selectedIds: Set<string>,
  patch: (el: CanvasElement) => CanvasElement,
): CanvasElement[] {
  return elements.map((el) => (selectedIds.has(el.id) ? patch(el) : el));
}

export function CanvasPropertiesPanel({
  layout,
  selected,
  themeColors,
  workspaceId,
  disabled,
  onChangeElements,
  onChangePageBackground,
}: Props) {
  const { t } = useTranslation();
  const ids = new Set(selected.map((el) => el.id));
  const single = selected.length === 1 ? selected[0] : null;
  const [variableSearch, setVariableSearch] = useState("");
  const [advancedToken, setAdvancedToken] = useState(false);
  const variableGroups = useMemo(() => groupedVisibleVariables(), []);
  const filteredVariableGroups = useMemo(() => {
    const q = variableSearch.trim().toLowerCase();
    if (!q) return variableGroups;
    return variableGroups
      .map((entry) => ({
        ...entry,
        variables: entry.variables.filter((variable) => {
          const label = String(t(variable.labelKey as never)).toLowerCase();
          return label.includes(q) || variable.token.toLowerCase().includes(q);
        }),
      }))
      .filter((entry) => entry.variables.length > 0);
  }, [variableGroups, variableSearch, t]);

  function clampRadius(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.min(10, Math.max(0, Math.round(value * 2) / 2));
  }

  function patchAll(patch: (el: CanvasElement) => CanvasElement) {
    onChangeElements((elements) => updateSelected(elements, ids, patch));
  }

  function applyColorToSelection(kind: "text" | "background" | "border", value: ColorRef | Fill | null) {
    patchAll((el) => {
      if (kind === "text") {
        return { ...el, style: { ...el.style, color: typeof value === "string" ? value : value?.color ?? el.style.color } };
      }
      if (kind === "background") {
        if (el.type === "rect") {
          return { ...el, fill: value && typeof value !== "string" ? value : value ? { color: value } : undefined };
        }
        return {
          ...el,
          style: {
            ...el.style,
            background: value == null ? undefined : typeof value === "string" ? { color: value } : value,
          },
        };
      }
      if (kind === "border" && typeof value === "string") {
        return {
          ...el,
          style: {
            ...el.style,
            border: { widthPt: el.style.border?.widthPt ?? 1, color: value, style: el.style.border?.style ?? "solid" },
          },
        };
      }
      return el;
    });
  }

  if (selected.length === 0) {
    return (
      <div className="space-y-4 p-3">
        <h3 className="text-sm font-medium">{t("settings.printTemplates.canvas.properties")}</h3>
        <ColorPicker
          label={t("settings.printTemplates.canvas.pageBackground")}
          value={layout.page.background ?? null}
          allowNoFill
          allowOpacity
          themeColors={themeColors}
          workspaceId={workspaceId}
          disabled={disabled}
          onChange={(next) => onChangePageBackground(next && typeof next !== "string" ? next : next ? { color: next } : null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 overflow-auto p-3">
      <h3 className="text-sm font-medium">{t("settings.printTemplates.canvas.properties")}</h3>
      <p className="text-xs text-muted-foreground">
        {selected.length > 1 ? `${selected.length}` : single?.type}
      </p>

      {single ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">{t("settings.printTemplates.canvas.position")} X</Label>
            <Input
              type="number"
              step={0.5}
              disabled={disabled || single.locked}
              value={single.xMm}
              onChange={(event) =>
                patchAll((el) => ({ ...el, xMm: Number(event.target.value) || 0 }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("settings.printTemplates.canvas.position")} Y</Label>
            <Input
              type="number"
              step={0.5}
              disabled={disabled || single.locked}
              value={single.yMm}
              onChange={(event) =>
                patchAll((el) => ({ ...el, yMm: Number(event.target.value) || 0 }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("settings.printTemplates.canvas.size")} W</Label>
            <Input
              type="number"
              step={0.5}
              disabled={disabled || single.locked}
              value={single.wMm}
              onChange={(event) =>
                patchAll((el) => ({ ...el, wMm: Math.max(1, Number(event.target.value) || 1) }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("settings.printTemplates.canvas.size")} H</Label>
            <Input
              type="number"
              step={0.5}
              disabled={disabled || single.locked}
              value={single.hMm}
              onChange={(event) =>
                patchAll((el) => ({ ...el, hMm: Math.max(1, Number(event.target.value) || 1) }))
              }
            />
          </div>
        </div>
      ) : null}

      {single?.type === "text" ? (
        <div className="space-y-1">
          <Label className="text-xs">{t("settings.printTemplates.canvas.text")}</Label>
          <textarea
            className="min-h-24 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            disabled={disabled}
            value={single.content}
            onChange={(event) => patchAll((el) => (el.type === "text" ? { ...el, content: event.target.value } : el))}
          />
          <div className="flex flex-wrap gap-1">
            {variableGroups[0]?.variables.slice(0, 8).map((variable) => (
              <Button
                key={variable.token}
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  patchAll((el) =>
                    el.type === "text" ? { ...el, content: `${el.content}${variable.token}` } : el,
                  )
                }
              >
                {String(t(variable.labelKey as never))}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {single?.type === "variable" ? (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-xs">{t("settings.printTemplates.canvas.variableField")}</Label>
            <Input
              value={variableSearch}
              disabled={disabled}
              placeholder={t("settings.printTemplates.variables.search")}
              onChange={(event) => setVariableSearch(event.target.value)}
            />
            <div className="max-h-48 space-y-2 overflow-auto rounded-md border border-border p-2">
              {filteredVariableGroups.map((entry) => (
                <div key={entry.group} className="space-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t(`settings.printTemplates.variables.groups.${entry.group}`)}
                  </p>
                  {entry.variables.map((variable) => {
                    const active = single.token === variable.token;
                    return (
                      <button
                        key={variable.token}
                        type="button"
                        disabled={disabled}
                        className={`flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm ${
                          active ? "bg-sky-100 text-sky-950" : "hover:bg-muted"
                        }`}
                        onClick={() =>
                          patchAll((el) => (el.type === "variable" ? { ...el, token: variable.token } : el))
                        }
                      >
                        <span className="font-medium">{String(t(variable.labelKey as never))}</span>
                        <span className="text-[11px] text-muted-foreground">{variable.token}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {resolveVariableLabel(single.token, t).label}
            </p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">{t("settings.printTemplates.canvas.advancedToken")}</Label>
            <Switch checked={advancedToken} onCheckedChange={setAdvancedToken} disabled={disabled} />
          </div>
          {advancedToken ? (
            <div className="space-y-1">
              <Label className="text-xs">{t("settings.printTemplates.canvas.rawToken")}</Label>
              <Input
                disabled={disabled}
                value={single.token}
                onChange={(event) =>
                  patchAll((el) => (el.type === "variable" ? { ...el, token: event.target.value } : el))
                }
              />
            </div>
          ) : null}
          <div className="space-y-1">
            <Label className="text-xs">{t("settings.printTemplates.canvas.fieldLabel")}</Label>
            <Input
              disabled={disabled}
              value={single.label ?? ""}
              onChange={(event) =>
                patchAll((el) => (el.type === "variable" ? { ...el, label: event.target.value } : el))
              }
            />
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">{t("settings.printTemplates.canvas.font")}</Label>
          <Input
            type="number"
            min={6}
            max={72}
            disabled={disabled}
            value={single?.style.fontSizePt ?? selected[0]?.style.fontSizePt ?? 10}
            onChange={(event) =>
              patchAll((el) => ({
                ...el,
                style: { ...el.style, fontSizePt: Math.min(72, Math.max(6, Number(event.target.value) || 10)) },
              }))
            }
          />
        </div>
        <div className="flex items-end gap-1">
          <Button
            type="button"
            size="sm"
            variant={selected.every((el) => el.style.bold) ? "default" : "outline"}
            disabled={disabled}
            onClick={() => patchAll((el) => ({ ...el, style: { ...el.style, bold: !el.style.bold } }))}
          >
            B
          </Button>
          <Button
            type="button"
            size="sm"
            variant={selected.every((el) => el.style.italic) ? "default" : "outline"}
            disabled={disabled}
            onClick={() => patchAll((el) => ({ ...el, style: { ...el.style, italic: !el.style.italic } }))}
          >
            I
          </Button>
          <Button
            type="button"
            size="sm"
            variant={selected.every((el) => el.style.underline) ? "default" : "outline"}
            disabled={disabled}
            onClick={() => patchAll((el) => ({ ...el, style: { ...el.style, underline: !el.style.underline } }))}
          >
            U
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">{t("settings.printTemplates.canvas.align")}</Label>
          <div className="flex gap-1">
            {(
              [
                ["left", "alignLeft"],
                ["center", "alignCenter"],
                ["right", "alignRight"],
              ] as const
            ).map(([align, key]) => (
              <Button
                key={align}
                type="button"
                size="sm"
                variant={selected.every((el) => el.style.align === align) ? "default" : "outline"}
                disabled={disabled}
                onClick={() => patchAll((el) => ({ ...el, style: { ...el.style, align } }))}
              >
                {t(`settings.printTemplates.canvas.${key}`)}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("settings.printTemplates.canvas.verticalAlign")}</Label>
          <div className="flex gap-1">
            {(
              [
                ["top", "verticalTop"],
                ["middle", "verticalMiddle"],
                ["bottom", "verticalBottom"],
              ] as const
            ).map(([verticalAlign, key]) => (
              <Button
                key={verticalAlign}
                type="button"
                size="sm"
                variant={
                  selected.every((el) => (el.style.verticalAlign ?? "top") === verticalAlign)
                    ? "default"
                    : "outline"
                }
                disabled={disabled}
                onClick={() =>
                  patchAll((el) => ({
                    ...el,
                    style: {
                      ...el.style,
                      verticalAlign: verticalAlign === "top" ? undefined : verticalAlign,
                    },
                  }))
                }
              >
                {t(`settings.printTemplates.canvas.${key}`)}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">{t("settings.printTemplates.canvas.cornerRadius")}</Label>
        <Input
          type="number"
          min={0}
          max={10}
          step={0.5}
          disabled={disabled}
          value={
            single?.type === "rect"
              ? (single.radiusMm ?? single.style.radiusMm ?? 0)
              : (single?.style.radiusMm ?? selected[0]?.style.radiusMm ?? 0)
          }
          onChange={(event) => {
            const radiusMm = clampRadius(Number(event.target.value));
            patchAll((el) => {
              if (el.type === "rect") {
                return { ...el, radiusMm, style: { ...el.style, radiusMm } };
              }
              return { ...el, style: { ...el.style, radiusMm: radiusMm || undefined } };
            });
          }}
        />
      </div>

      <ColorPicker
        label={t("settings.printTemplates.canvas.textColor")}
        value={single?.style.color ?? selected[0]?.style.color}
        themeColors={themeColors}
        workspaceId={workspaceId}
        disabled={disabled}
        onChange={(next) => applyColorToSelection("text", next)}
      />
      <ColorPicker
        label={t("settings.printTemplates.canvas.background")}
        value={
          single?.type === "rect"
            ? single.fill
            : single?.style.background ?? selected[0]?.style.background ?? null
        }
        allowNoFill
        allowOpacity
        themeColors={themeColors}
        workspaceId={workspaceId}
        disabled={disabled}
        onChange={(next) => applyColorToSelection("background", next)}
      />
      <ColorPicker
        label={t("settings.printTemplates.canvas.borderColor")}
        value={single?.style.border?.color ?? selected[0]?.style.border?.color ?? "#000000"}
        themeColors={themeColors}
        workspaceId={workspaceId}
        disabled={disabled}
        onChange={(next) => applyColorToSelection("border", next)}
      />

      {single?.type === "table" ? (
        <div className="space-y-3 border-t border-border pt-3">
          <ColorPicker
            label={t("settings.printTemplates.canvas.headerBackground")}
            value={single.headerBackground}
            themeColors={themeColors}
            workspaceId={workspaceId}
            disabled={disabled}
            onChange={(next) =>
              patchAll((el) =>
                el.type === "table" && typeof next === "string" ? { ...el, headerBackground: next } : el,
              )
            }
          />
          <ColorPicker
            label={t("settings.printTemplates.canvas.headerText")}
            value={single.headerTextColor}
            themeColors={themeColors}
            workspaceId={workspaceId}
            disabled={disabled}
            onChange={(next) =>
              patchAll((el) =>
                el.type === "table" && typeof next === "string" ? { ...el, headerTextColor: next } : el,
              )
            }
          />
          <ColorPicker
            label={t("settings.printTemplates.canvas.rowBackground")}
            value={single.rowBackground ?? null}
            allowNoFill
            themeColors={themeColors}
            workspaceId={workspaceId}
            disabled={disabled}
            onChange={(next) =>
              patchAll((el) =>
                el.type === "table"
                  ? { ...el, rowBackground: typeof next === "string" ? next : undefined }
                  : el,
              )
            }
          />
          <ColorPicker
            label={t("settings.printTemplates.canvas.zebra")}
            value={single.zebraBackground ?? null}
            allowNoFill
            themeColors={themeColors}
            workspaceId={workspaceId}
            disabled={disabled}
            onChange={(next) =>
              patchAll((el) =>
                el.type === "table"
                  ? { ...el, zebraBackground: typeof next === "string" ? next : undefined }
                  : el,
              )
            }
          />
          <ColorPicker
            label={t("settings.printTemplates.canvas.totalsBackground")}
            value={single.totalsRowBackground ?? null}
            allowNoFill
            themeColors={themeColors}
            workspaceId={workspaceId}
            disabled={disabled}
            onChange={(next) =>
              patchAll((el) =>
                el.type === "table"
                  ? { ...el, totalsRowBackground: typeof next === "string" ? next : undefined }
                  : el,
              )
            }
          />
          <div className="space-y-1">
            <Label className="text-xs">{t("settings.printTemplates.canvas.headerRadius")}</Label>
            <Input
              type="number"
              min={0}
              max={10}
              step={0.5}
              disabled={disabled}
              value={single.headerRadiusMm ?? 0}
              onChange={(event) => {
                const headerRadiusMm = clampRadius(Number(event.target.value));
                patchAll((el) =>
                  el.type === "table"
                    ? { ...el, headerRadiusMm: headerRadiusMm || undefined }
                    : el,
                );
              }}
            />
          </div>
        </div>
      ) : null}

      {single?.type === "totals" ? (
        <div className="space-y-3 border-t border-border pt-3">
          <ColorPicker
            label={t("settings.printTemplates.canvas.grandTotal")}
            value={single.grandTotalBackground ?? null}
            allowNoFill
            themeColors={themeColors}
            workspaceId={workspaceId}
            disabled={disabled}
            onChange={(next) =>
              patchAll((el) =>
                el.type === "totals"
                  ? { ...el, grandTotalBackground: typeof next === "string" ? next : undefined }
                  : el,
              )
            }
          />
          <div className="space-y-1">
            <Label className="text-xs">{t("settings.printTemplates.canvas.grandTotalRadius")}</Label>
            <Input
              type="number"
              min={0}
              max={10}
              step={0.5}
              disabled={disabled}
              value={single.grandTotalRadiusMm ?? 0}
              onChange={(event) => {
                const grandTotalRadiusMm = clampRadius(Number(event.target.value));
                patchAll((el) =>
                  el.type === "totals"
                    ? { ...el, grandTotalRadiusMm: grandTotalRadiusMm || undefined }
                    : el,
                );
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{t("settings.printTemplates.canvas.repeatOnEveryPage")}</Label>
        <Switch
          checked={selected.every((el) => el.repeatOnEveryPage)}
          disabled={disabled}
          onCheckedChange={(checked) => patchAll((el) => ({ ...el, repeatOnEveryPage: checked }))}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{t("settings.printTemplates.canvas.lock")}</Label>
        <Switch
          checked={selected.every((el) => el.locked)}
          disabled={disabled}
          onCheckedChange={(checked) => patchAll((el) => ({ ...el, locked: checked }))}
        />
      </div>
    </div>
  );
}
