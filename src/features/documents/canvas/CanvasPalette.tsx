import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { TEMPLATE_VARIABLES, type VariableGroup } from "../templateVariables";
import type { CanvasElementType } from "./types";
import type { PaletteDragPayload } from "./createElement";
import { Input } from "../../../ui/Input";
import { cn } from "../../../lib/utils";

const ELEMENT_TYPES: CanvasElementType[] = [
  "text",
  "table",
  "totals",
  "rect",
  "image",
  "line",
  "signatures",
  "qr",
  "pageNumber",
];

function elementLabelKey(type: CanvasElementType): string {
  switch (type) {
    case "text":
      return "settings.printTemplates.canvas.text";
    case "table":
      return "settings.printTemplates.canvas.table";
    case "totals":
      return "settings.printTemplates.canvas.totals";
    case "rect":
      return "settings.printTemplates.canvas.coloredArea";
    case "image":
      return "settings.printTemplates.canvas.image";
    case "line":
      return "settings.printTemplates.canvas.line";
    case "signatures":
      return "settings.printTemplates.canvas.signatures";
    case "qr":
      return "settings.printTemplates.canvas.qr";
    case "pageNumber":
      return "settings.printTemplates.canvas.pageNumber";
    case "variable":
      return "settings.printTemplates.canvas.variables";
  }
}

function DraggableChip({
  id,
  payload,
  children,
  onAdd,
}: {
  id: string;
  payload: PaletteDragPayload;
  children: React.ReactNode;
  onAdd?: (payload: PaletteDragPayload) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data: payload });
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "w-full rounded-md border border-border bg-background px-2 py-1.5 text-left text-xs hover:bg-muted/60",
        isDragging && "opacity-50",
      )}
      style={{ transform: CSS.Translate.toString(transform) }}
      onClick={() => onAdd?.(payload)}
    >
      {children}
    </button>
  );
}

const GROUP_ORDER: VariableGroup[] = [
  "document",
  "order",
  "invoice",
  "client",
  "vehicle",
  "company",
  "staff",
  "money",
  "warranty",
  "tables",
];

export function CanvasPalette({ onAddElement }: { onAddElement?: (payload: PaletteDragPayload) => void } = {}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const variables = useMemo(() => {
    return TEMPLATE_VARIABLES.filter((variable) => {
      if (!q) return true;
      const label = String(t(variable.labelKey as never)).toLowerCase();
      return variable.token.toLowerCase().includes(q) || label.includes(q);
    });
  }, [q, t]);

  const grouped = useMemo(() => {
    const map = new Map<VariableGroup, typeof variables>();
    for (const variable of variables) {
      const list = map.get(variable.group) ?? [];
      list.push(variable);
      map.set(variable.group, list);
    }
    return GROUP_ORDER.map((group) => ({ group, items: map.get(group) ?? [] })).filter((entry) => entry.items.length > 0);
  }, [variables]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3">
      <div>
        <h3 className="text-sm font-medium">{t("settings.printTemplates.canvas.elements")}</h3>
        <div className="mt-2 grid gap-1.5">
          {ELEMENT_TYPES.filter((type) => !q || String(t(elementLabelKey(type) as never)).toLowerCase().includes(q)).map((type) => (
            <DraggableChip
              key={type}
              id={`palette-el-${type}`}
              payload={{ kind: "element", elementType: type }}
              onAdd={onAddElement}
            >
              {t(elementLabelKey(type) as never)}
            </DraggableChip>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <h3 className="text-sm font-medium">{t("settings.printTemplates.canvas.variables")}</h3>
        <Input
          className="mt-2"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("common.search")}
        />
        <div className="mt-2 space-y-3">
          {grouped.map(({ group, items }) => (
            <div key={group}>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{group}</p>
              <div className="grid gap-1">
                {items.map((variable) => (
                  <DraggableChip
                    key={variable.token}
                    id={`palette-var-${variable.token}`}
                    payload={{
                      kind: "variable",
                      token: variable.token,
                      label: String(t(variable.labelKey as never)),
                    }}
                    onAdd={onAddElement}
                  >
                    <span className="font-medium">{t(variable.labelKey as never)}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{variable.token}</span>
                  </DraggableChip>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
