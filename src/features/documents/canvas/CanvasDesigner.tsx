import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import toast from "react-hot-toast";
import type { DocumentTemplate } from "../../../services/apiDocumentTemplates";
import { buildInvoicePrintContext, buildOrderPrintContext, listRecentInvoicesForPrintPreview, listRecentOrdersForPrintPreview } from "../../../services/printContext";
import { useActiveWorkspaceId } from "../../profiles/useGetProfile";
import { useGetDocumentStyle } from "../useGetDocumentStyle";
import { useSaveDocumentTemplateLayout } from "../useDocumentTemplateMutations";
import { buildPrintDocument } from "../printTemplate";
import type { DocumentTemplateType } from "../layout";
import { Button } from "../../../ui/Button";
import { Input } from "../../../ui/Input";
import { Label } from "../../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../ui/Select";
import { Switch } from "../../../ui/Switch";
import { useUnsavedChangesConfirm } from "../../../ui/ConfirmProvider";
import { CanvasPalette } from "./CanvasPalette";
import { CanvasPropertiesPanel } from "./CanvasPropertiesPanel";
import { createCanvasElementFromPalette, type PaletteDragPayload } from "./createElement";
import { defaultCanvasLayoutForType } from "./defaultCanvasLayouts";
import { createHistory, pushHistory, redoHistory, undoHistory, type CanvasHistory } from "./history";
import { isCanvasDocumentLayout, parseCanvasDocumentLayout } from "./guards";
import { renderCanvasLayoutToHtmlSync, canvasPageCss } from "./renderCanvasLayout";
import { snapBox, snapValue, type Guide } from "./snap";
import { pageSizeMm, type CanvasDocumentLayout, type CanvasElement } from "./types";
import { convertBlocksLayoutToCanvas } from "./convertToCanvas";
import { isDocumentLayout } from "../layout";
import { emptyPrintContext } from "../templateVariables";
import { resolveColorRef } from "../colorRef";
import { fillToCss } from "./fill";

type Props = {
  template: DocumentTemplate;
  canEdit: boolean;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Open the legacy block builder for this template. */
  onOpenSimpleMode?: () => void;
};

function cloneLayout(layout: CanvasDocumentLayout): CanvasDocumentLayout {
  return structuredClone(layout);
}

function layoutsEqual(a: CanvasDocumentLayout, b: CanvasDocumentLayout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MM_TO_PX = 3.7795275591; // CSS px at 96dpi

export function CanvasDesigner({ template, canEdit, onClose, onDirtyChange, onOpenSimpleMode }: Props) {
  const { t } = useTranslation();
  const confirmUnsaved = useUnsavedChangesConfirm();
  const { workspaceId } = useActiveWorkspaceId();
  const save = useSaveDocumentTemplateLayout();
  const documentStyleQuery = useGetDocumentStyle();
  const documentType = (template.documentType === "act" || template.documentType === "invoice" || template.documentType === "work_order"
    ? template.documentType
    : "work_order") as DocumentTemplateType;

  const initialLayout = useMemo(() => {
    if (template.layout && isCanvasDocumentLayout(template.layout)) {
      return parseCanvasDocumentLayout(template.layout) ?? defaultCanvasLayoutForType(documentType);
    }
    if (template.layout && isDocumentLayout(template.layout)) {
      return convertBlocksLayoutToCanvas(template.layout);
    }
    return defaultCanvasLayoutForType(documentType);
  }, [template.layout, documentType]);

  const [history, setHistory] = useState<CanvasHistory>(() => createHistory(initialLayout));
  const layout = history.present;
  const [name, setName] = useState(template.name);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(100);
  const [showGrid] = useState(true);
  const [showData, setShowData] = useState(false);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [previewEntityId, setPreviewEntityId] = useState("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<CanvasElement[]>([]);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragPayloadRef = useRef<PaletteDragPayload | null>(null);

  const baseline = useRef(cloneLayout(initialLayout));
  const dirty = !layoutsEqual(layout, baseline.current) || name !== template.name;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const themeColors = documentStyleQuery.data?.colors ?? null;
  const selected = layout.elements.filter((el) => selectedIds.includes(el.id));
  const { widthMm, heightMm } = pageSizeMm(layout.page.size, layout.page.orientation);
  const scale = zoom / 100;

  const commit = useCallback((next: CanvasDocumentLayout) => {
    setHistory((prev) => pushHistory(prev, next));
  }, []);

  const setElements = useCallback(
    (updater: (elements: CanvasElement[]) => CanvasElement[]) => {
      commit({ ...layout, elements: updater(layout.elements) });
    },
    [commit, layout],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const isInvoice = documentType === "invoice";
  const recentOrdersQuery = useQuery({
    queryKey: ["print-builder-preview-orders", workspaceId],
    queryFn: () => listRecentOrdersForPrintPreview(workspaceId, 20),
    enabled: Boolean(workspaceId) && !isInvoice,
    staleTime: 30_000,
  });
  const recentInvoicesQuery = useQuery({
    queryKey: ["print-builder-preview-invoices", workspaceId],
    queryFn: () => listRecentInvoicesForPrintPreview(workspaceId, 20),
    enabled: Boolean(workspaceId) && isInvoice,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!previewEntityId) {
      setPreviewHtml(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const ctx = isInvoice
          ? await buildInvoicePrintContext(previewEntityId, workspaceId)
          : await buildOrderPrintContext(previewEntityId, workspaceId, documentType);
        if (cancelled) return;
        const body = await import("./renderCanvasLayout").then((m) =>
          m.renderCanvasLayoutToHtml(layout, ctx, {
            showCents: template.showCents,
            colors: themeColors,
          }),
        );
        const pageCss = canvasPageCss(layout);
        setPreviewHtml(buildPrintDocument(body, name, pageCss));
      } catch {
        if (!cancelled) setPreviewHtml(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewEntityId, layout, workspaceId, isInvoice, documentType, template.showCents, themeColors, name]);

  function mmFromClient(clientX: number, clientY: number): { xMm: number; yMm: number } | null {
    const sheet = sheetRef.current;
    if (!sheet) return null;
    const rect = sheet.getBoundingClientRect();
    const xMm = (clientX - rect.left) / (MM_TO_PX * scale);
    const yMm = (clientY - rect.top) / (MM_TO_PX * scale);
    return { xMm, yMm };
  }

  function handleDragEnd(event: DragEndEvent) {
    const payload = (event.active.data.current ?? dragPayloadRef.current) as PaletteDragPayload | null;
    dragPayloadRef.current = null;
    if (!payload || !canEdit) return;
    const overPoint = event.activatorEvent as PointerEvent | undefined;
    const clientX = "clientX" in (event.activatorEvent as object) ? (event.activatorEvent as PointerEvent).clientX + (event.delta?.x ?? 0) : 0;
    const clientY = overPoint && "clientY" in overPoint ? overPoint.clientY + (event.delta?.y ?? 0) : 0;
    // Prefer translated pointer from delta
    const endX = (event.activatorEvent as PointerEvent).clientX + event.delta.x;
    const endY = (event.activatorEvent as PointerEvent).clientY + event.delta.y;
    void clientX;
    void clientY;
    const point = mmFromClient(endX, endY);
    if (!point) return;
    const xMm = snapValue(Math.max(0, point.xMm), layout.gridMm, true);
    const yMm = snapValue(Math.max(0, point.yMm), layout.gridMm, true);
    const created = createCanvasElementFromPalette(payload, xMm, yMm);
    commit({ ...layout, elements: [...layout.elements, created] });
    setSelectedIds([created.id]);
  }

  // Pointer move / resize
  const interactionRef = useRef<
    | { mode: "move"; startX: number; startY: number; origins: Array<{ id: string; xMm: number; yMm: number }> }
    | { mode: "resize"; handle: ResizeHandle; startX: number; startY: number; origin: CanvasElement }
    | null
  >(null);
  const dragStartLayoutRef = useRef<CanvasDocumentLayout | null>(null);

  function onSheetPointerDown(event: React.PointerEvent) {
    if (event.target === sheetRef.current) {
      if (!event.shiftKey) setSelectedIds([]);
    }
  }

  function onElementPointerDown(event: React.PointerEvent, el: CanvasElement) {
    event.stopPropagation();
    if (el.locked) {
      setSelectedIds([el.id]);
      return;
    }
    if (event.shiftKey) {
      setSelectedIds((prev) => (prev.includes(el.id) ? prev.filter((id) => id !== el.id) : [...prev, el.id]));
    } else if (!selectedIds.includes(el.id)) {
      setSelectedIds([el.id]);
    }
    const targets = selectedIds.includes(el.id) ? selectedIds : [el.id];
    const origins = layout.elements.filter((item) => targets.includes(item.id)).map((item) => ({ id: item.id, xMm: item.xMm, yMm: item.yMm }));
    dragStartLayoutRef.current = cloneLayout(layout);
    interactionRef.current = { mode: "move", startX: event.clientX, startY: event.clientY, origins };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onResizePointerDown(event: React.PointerEvent, el: CanvasElement, handle: ResizeHandle) {
    event.stopPropagation();
    if (el.locked) return;
    setSelectedIds([el.id]);
    dragStartLayoutRef.current = cloneLayout(layout);
    interactionRef.current = { mode: "resize", handle, startX: event.clientX, startY: event.clientY, origin: structuredClone(el) };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent) {
    const interaction = interactionRef.current;
    if (!interaction || !canEdit) return;
    const dxMm = (event.clientX - interaction.startX) / (MM_TO_PX * scale);
    const dyMm = (event.clientY - interaction.startY) / (MM_TO_PX * scale);

    if (interaction.mode === "move") {
      const movingIds = new Set(interaction.origins.map((o) => o.id));
      const others = layout.elements.filter((el) => !movingIds.has(el.id));
      let guidesNext: Guide[] = [];
      const nextElements = layout.elements.map((el) => {
        const origin = interaction.origins.find((o) => o.id === el.id);
        if (!origin) return el;
        const snapped = snapBox(
          { xMm: origin.xMm + dxMm, yMm: origin.yMm + dyMm, wMm: el.wMm, hMm: el.hMm },
          others,
          layout.gridMm,
          true,
        );
        guidesNext = snapped.guides;
        return { ...el, xMm: Math.max(0, snapped.xMm), yMm: Math.max(0, snapped.yMm) };
      });
      setGuides(guidesNext);
      setHistory((prev) => ({ ...prev, present: { ...prev.present, elements: nextElements } }));
      return;
    }

    const o = interaction.origin;
    let { xMm, yMm, wMm, hMm } = o;
    const keepAspect = event.shiftKey;
    const handle = interaction.handle;
    if (handle.includes("e")) wMm = Math.max(5, o.wMm + dxMm);
    if (handle.includes("s")) hMm = Math.max(5, o.hMm + dyMm);
    if (handle.includes("w")) {
      wMm = Math.max(5, o.wMm - dxMm);
      xMm = o.xMm + (o.wMm - wMm);
    }
    if (handle.includes("n")) {
      hMm = Math.max(5, o.hMm - dyMm);
      yMm = o.yMm + (o.hMm - hMm);
    }
    if (keepAspect && (handle === "se" || handle === "nw" || handle === "ne" || handle === "sw")) {
      const ratio = o.wMm / o.hMm;
      hMm = wMm / ratio;
    }
    setHistory((prev) => ({
      ...prev,
      present: {
        ...prev.present,
        elements: prev.present.elements.map((el) =>
          el.id === o.id
            ? {
                ...el,
                xMm: snapValue(xMm, layout.gridMm, true),
                yMm: snapValue(yMm, layout.gridMm, true),
                wMm: snapValue(wMm, layout.gridMm, true),
                hMm: snapValue(hMm, layout.gridMm, true),
              }
            : el,
        ),
      },
    }));
  }

  function onPointerUp() {
    if (!interactionRef.current) return;
    interactionRef.current = null;
    setGuides([]);
    const before = dragStartLayoutRef.current;
    dragStartLayoutRef.current = null;
    if (!before) return;
    setHistory((prev) => {
      if (layoutsEqual(before, prev.present)) return prev;
      return { past: [...prev.past, before].slice(-80), present: prev.present, future: [] };
    });
  }

  // Keyboard
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setHistory((prev) => (event.shiftKey ? redoHistory(prev) : undoHistory(prev)));
        return;
      }
      if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        setHistory((prev) => redoHistory(prev));
        return;
      }
      if (meta && event.key.toLowerCase() === "c") {
        setClipboard(selected.map((el) => structuredClone(el)));
        return;
      }
      if (meta && event.key.toLowerCase() === "v" && clipboard.length) {
        event.preventDefault();
        const copies = clipboard.map((el) => ({
          ...structuredClone(el),
          id: `${el.id}_copy_${Math.random().toString(36).slice(2, 6)}`,
          xMm: el.xMm + 4,
          yMm: el.yMm + 4,
        }));
        commit({ ...layout, elements: [...layout.elements, ...copies] });
        setSelectedIds(copies.map((el) => el.id));
        return;
      }
      if (meta && event.key.toLowerCase() === "d" && selected.length) {
        event.preventDefault();
        const copies = selected.map((el) => ({
          ...structuredClone(el),
          id: `${el.id}_dup_${Math.random().toString(36).slice(2, 6)}`,
          xMm: el.xMm + 4,
          yMm: el.yMm + 4,
        }));
        commit({ ...layout, elements: [...layout.elements, ...copies] });
        setSelectedIds(copies.map((el) => el.id));
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length && canEdit) {
        const tag = (event.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        event.preventDefault();
        commit({ ...layout, elements: layout.elements.filter((el) => !selectedIds.includes(el.id) || el.locked) });
        setSelectedIds([]);
        return;
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && selectedIds.length) {
        event.preventDefault();
        const step = event.shiftKey ? layout.gridMm : 1;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        commit({
          ...layout,
          elements: layout.elements.map((el) =>
            selectedIds.includes(el.id) && !el.locked ? { ...el, xMm: el.xMm + dx, yMm: el.yMm + dy } : el,
          ),
        });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, selectedIds, clipboard, layout, canEdit, commit]);

  async function handleSave() {
    if (!canEdit) return;
    try {
      const ctx = emptyPrintContext({ documentKind: documentType, locale: "ru" });
      const bodyHtml = renderCanvasLayoutToHtmlSync(layout, ctx, {
        showCents: template.showCents,
        colors: themeColors,
      });
      await save.mutateAsync({
        templateId: template.id,
        name: name.trim() || template.name,
        layout,
        bodyHtml,
      });
      baseline.current = cloneLayout(layout);
      toast.success(t("settings.printTemplates.toast.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
    }
  }

  async function handleClose() {
    if (dirty && !(await confirmUnsaved())) return;
    onClose();
  }

  function bringForward() {
    const maxZ = layout.elements.reduce((max, el) => Math.max(max, el.zIndex), 0);
    setElements((elements) =>
      elements.map((el) => (selectedIds.includes(el.id) ? { ...el, zIndex: maxZ + 1 } : el)),
    );
  }

  function sendBackward() {
    const minZ = layout.elements.reduce((min, el) => Math.min(min, el.zIndex), 0);
    setElements((elements) =>
      elements.map((el) => (selectedIds.includes(el.id) ? { ...el, zIndex: minZ - 1 } : el)),
    );
  }

  function resetDefault() {
    commit(defaultCanvasLayoutForType(documentType));
    setSelectedIds([]);
  }

  const pageBg = fillToCss(layout.page.background, themeColors);
  const previewShowData = showData
    ? renderCanvasLayoutToHtmlSync(layout, emptyPrintContext({ documentKind: documentType }), {
        colors: themeColors,
        showTokens: false,
      })
    : null;

  const handles: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event) => {
        dragPayloadRef.current = (event.active.data.current as PaletteDragPayload) ?? null;
      }}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-[min(85vh,900px)] min-h-[560px] flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
          <Input className="max-w-xs" value={name} disabled={!canEdit} onChange={(event) => setName(event.target.value)} />
          <span className="text-xs text-muted-foreground">{t(`settings.printTemplates.documentTypes.${documentType}`)}</span>
          <Select
            value={layout.page.size}
            disabled={!canEdit}
            onValueChange={(value) => commit({ ...layout, page: { ...layout.page, size: value as "A4" | "A5" } })}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="A4">A4</SelectItem>
              <SelectItem value="A5">A5</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Button type="button" size="sm" variant="outline" disabled={history.past.length === 0} onClick={() => setHistory((h) => undoHistory(h))}>
              Undo
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={history.future.length === 0} onClick={() => setHistory((h) => redoHistory(h))}>
              Redo
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">{t("settings.printTemplates.canvas.showData")}</Label>
            <Switch checked={showData} onCheckedChange={setShowData} />
          </div>
          <Input
            type="range"
            min={50}
            max={200}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-28"
          />
          <span className="text-xs tabular-nums">{zoom}%</span>
          <Button type="button" size="sm" variant="outline" onClick={bringForward} disabled={!canEdit || !selectedIds.length}>
            {t("settings.printTemplates.canvas.bringForward")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={sendBackward} disabled={!canEdit || !selectedIds.length}>
            {t("settings.printTemplates.canvas.sendBackward")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={resetDefault} disabled={!canEdit}>
            {t("settings.printTemplates.resetDefault")}
          </Button>
          {onOpenSimpleMode ? (
            <Button type="button" size="sm" variant="ghost" onClick={onOpenSimpleMode}>
              {t("settings.printTemplates.canvas.simpleMode")}
            </Button>
          ) : null}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={() => void handleClose()}>
              {t("common.close")}
            </Button>
            <Button type="button" disabled={!canEdit || save.isPending} onClick={() => void handleSave()}>
              {t("settings.printTemplates.save")}
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr_280px] gap-2">
          <div className="min-h-0 overflow-hidden rounded-md border border-border">
            <CanvasPalette />
          </div>

          <div className="min-h-0 overflow-auto rounded-md border border-border bg-muted/30 p-4">
            <div
              className="mx-auto origin-top shadow-lg"
              style={{
                width: widthMm * MM_TO_PX * scale,
                height: heightMm * MM_TO_PX * scale,
              }}
            >
              <div
                ref={sheetRef}
                role="application"
                aria-label={t("settings.printTemplates.canvas.designer")}
                className="relative bg-white"
                style={{
                  width: widthMm * MM_TO_PX,
                  height: heightMm * MM_TO_PX,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                  background: pageBg ?? "#ffffff",
                  backgroundImage: showGrid
                    ? `linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)`
                    : undefined,
                  backgroundSize: showGrid ? `${layout.gridMm * MM_TO_PX}px ${layout.gridMm * MM_TO_PX}px` : undefined,
                }}
                onPointerDown={onSheetPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                {/* margin guides */}
                <div
                  className="pointer-events-none absolute border border-dashed border-sky-400/50"
                  style={{
                    left: layout.page.marginsMm * MM_TO_PX,
                    top: layout.page.marginsMm * MM_TO_PX,
                    width: (widthMm - layout.page.marginsMm * 2) * MM_TO_PX,
                    height: (heightMm - layout.page.marginsMm * 2) * MM_TO_PX,
                  }}
                />

                {layout.elements
                  .slice()
                  .sort((a, b) => a.zIndex - b.zIndex)
                  .map((el) => {
                    const isSelected = selectedIds.includes(el.id);
                    const bg =
                      el.type === "rect"
                        ? fillToCss(el.fill, themeColors)
                        : fillToCss(el.style.background, themeColors);
                    const color = resolveColorRef(el.style.color, themeColors ?? {
                      primary: "#1a6de0",
                      primaryDark: "#1e3a8a",
                      tint: "#eff6ff",
                      muted: "#64748b",
                      text: "#1f2933",
                      border: "#e5e7eb",
                    });
                    return (
                      <div
                        key={el.id}
                        className={`absolute box-border ${isSelected ? "ring-2 ring-sky-500" : "hover:ring-1 hover:ring-sky-300"}`}
                        style={{
                          left: el.xMm * MM_TO_PX,
                          top: el.yMm * MM_TO_PX,
                          width: el.wMm * MM_TO_PX,
                          height: el.hMm * MM_TO_PX,
                          zIndex: el.zIndex,
                          background: bg,
                          color,
                          fontSize: el.style.fontSizePt,
                          fontWeight: el.style.bold ? 700 : 400,
                          fontStyle: el.style.italic ? "italic" : "normal",
                          textDecoration: el.style.underline ? "underline" : "none",
                          textAlign: el.style.align,
                          padding: el.style.paddingMm * MM_TO_PX,
                          overflow: "hidden",
                          cursor: el.locked ? "default" : "move",
                        }}
                        onPointerDown={(event) => onElementPointerDown(event, el)}
                      >
                        {el.type === "text" ? el.content : null}
                        {el.type === "variable" ? `${el.label ? `${el.label}: ` : ""}${el.token}` : null}
                        {el.type === "table" ? t("settings.printTemplates.canvas.table") : null}
                        {el.type === "totals" ? t("settings.printTemplates.canvas.totals") : null}
                        {el.type === "rect" ? null : null}
                        {el.type === "image" ? t("settings.printTemplates.canvas.image") : null}
                        {el.type === "line" ? null : null}
                        {el.type === "signatures" ? t("settings.printTemplates.canvas.signatures") : null}
                        {el.type === "qr" ? t("settings.printTemplates.canvas.qr") : null}
                        {el.type === "pageNumber" ? el.format ?? "N/M" : null}

                        {isSelected && !el.locked
                          ? handles.map((handle) => (
                              <div
                                key={handle}
                                className="absolute h-2 w-2 bg-sky-500"
                                style={{
                                  left: handle.includes("w") ? -4 : handle.includes("e") ? "calc(100% - 4px)" : "calc(50% - 4px)",
                                  top: handle.includes("n") ? -4 : handle.includes("s") ? "calc(100% - 4px)" : "calc(50% - 4px)",
                                  cursor: `${handle}-resize`,
                                }}
                                onPointerDown={(event) => onResizePointerDown(event, el, handle)}
                              />
                            ))
                          : null}
                      </div>
                    );
                  })}

                {guides.map((guide, index) => (
                  <div
                    key={`${guide.orientation}-${guide.positionMm}-${index}`}
                    className="pointer-events-none absolute bg-fuchsia-500"
                    style={
                      guide.orientation === "v"
                        ? { left: guide.positionMm * MM_TO_PX, top: 0, width: 1, height: "100%" }
                        : { top: guide.positionMm * MM_TO_PX, left: 0, height: 1, width: "100%" }
                    }
                  />
                ))}

                {layout.elements.length === 0 ? (
                  <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                    {t("settings.printTemplates.canvas.dropHere")}
                  </p>
                ) : null}

                {showData && previewShowData ? (
                  <div
                    className="pointer-events-none absolute inset-0 opacity-40"
                    // Designer overlay hint only — real preview uses the iframe below.
                    dangerouslySetInnerHTML={{ __html: "" }}
                  />
                ) : null}
              </div>
            </div>
          </div>

          <div className="min-h-0 overflow-hidden rounded-md border border-border">
            <CanvasPropertiesPanel
              layout={layout}
              selected={selected}
              themeColors={themeColors}
              workspaceId={workspaceId}
              disabled={!canEdit}
              onChangeElements={setElements}
              onChangePageBackground={(fill) =>
                commit({
                  ...layout,
                  page: { ...layout.page, background: fill ?? undefined },
                })
              }
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <Label className="text-xs">{t("settings.printTemplates.preview")}</Label>
          <Select value={previewEntityId || "__none__"} onValueChange={(value) => setPreviewEntityId(value === "__none__" ? "" : value)}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder={t("settings.printTemplates.previewHint")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">—</SelectItem>
              {(isInvoice ? recentInvoicesQuery.data : recentOrdersQuery.data)?.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {"orderNumber" in item ? item.orderNumber : item.invoiceNumber}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {previewHtml ? (
          <iframe title="preview" className="h-64 w-full rounded-md border border-border bg-white" srcDoc={previewHtml} />
        ) : null}
      </div>
      <DragOverlay />
    </DndContext>
  );
}

/** Helper used by settings to detect canvas layouts. */
export function templateIsCanvas(template: DocumentTemplate): boolean {
  return isCanvasDocumentLayout(template.layout);
}

export { convertBlocksLayoutToCanvas };
