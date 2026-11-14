import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import { ArrowLeft, MoreHorizontal, Redo2, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import toast from "react-hot-toast";
import type { DocumentTemplate } from "../../../services/apiDocumentTemplates";
import { buildInvoicePrintContext, buildOrderPrintContext, listRecentInvoicesForPrintPreview, listRecentOrdersForPrintPreview } from "../../../services/printContext";
import { useActiveWorkspaceId } from "../../profiles/useGetProfile";
import { useGetDocumentStyle } from "../useGetDocumentStyle";
import { useSaveDocumentTemplateLayout } from "../useDocumentTemplateMutations";
import { applyTemplateVariables, buildPrintDocument } from "../printTemplate";
import type { DocumentTemplateType } from "../layout";
import { Button } from "../../../ui/Button";
import { Dialog, DialogContent, DialogTitle } from "../../../ui/Dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../ui/DropdownMenu";
import { Input } from "../../../ui/Input";
import { Label } from "../../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../ui/Select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../../ui/Sheet";
import { Switch } from "../../../ui/Switch";
import { useUnsavedChangesConfirm } from "../../../ui/ConfirmProvider";
import { useIsMobile } from "../../../hooks/use-mobile";
import { cn } from "../../../lib/utils";
import { CanvasPalette } from "./CanvasPalette";
import { CanvasPropertiesPanel } from "./CanvasPropertiesPanel";
import {
  createCanvasElementFromPalette,
  defaultPaletteElementSizeMm,
  type PaletteDragPayload,
} from "./createElement";
import { defaultCanvasLayoutForType } from "./defaultCanvasLayouts";
import { CANVAS_MM_TO_PX, computeFitWidthZoomPercent, needsFitWidth } from "./fitWidthZoom";
import { createHistory, pushHistory, redoHistory, undoHistory, type CanvasHistory } from "./history";
import { isCanvasDocumentLayout, parseCanvasDocumentLayout } from "./guards";
import { renderCanvasLayoutToHtmlSync, canvasPageCss } from "./renderCanvasLayout";
import { snapBox, snapValue, type Guide } from "./snap";
import { pageSizeMm, type CanvasDocumentLayout, type CanvasElement } from "./types";
import { convertBlocksLayoutToCanvas } from "./convertToCanvas";
import { isDocumentLayout } from "../layout";
import { DEMO_PRINT_SOURCE_ID, demoPrintContext } from "../demoPrintContext";
import { isDemoPrintSource } from "../templatePreviewHtml";
import { findUnknownTokensInCanvasLayout } from "../templateTokenScan";
import { emptyPrintContext } from "../templateVariables";
import { fillToCss } from "./fill";
import { buildCanvasBoxStyle, rectElementReactStyle } from "./canvasElementStyle";
import { clampBoxToContent, contentBoxMm, contentMmFromSheetClient } from "./contentBox";
import { dropPreviewBoxFromContentPoint } from "./paletteDrop";
import { resolveVariableLabel, segmentTextWithVariables } from "./variableDisplay";

type SidePanel = "palette" | "properties" | null;
type MarqueeState = { originX: number; originY: number; x: number; y: number; additive: boolean };

function useIsLargeScreen() {
  const [isLg, setIsLg] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(min-width: 1024px)").matches
      : true,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsLg(mql.matches);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isLg;
}

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

const MM_TO_PX = CANVAS_MM_TO_PX;

function VariableChip({ label, known }: { label: string; known: boolean }) {
  return (
    <span
      className={
        known
          ? "mx-0.5 inline-flex rounded bg-sky-100 px-1.5 py-0.5 text-[0.85em] font-medium text-sky-900"
          : "mx-0.5 inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[0.85em] font-medium text-amber-900"
      }
      title={known ? undefined : label}
    >
      {label}
    </span>
  );
}

export function CanvasDesigner({ template, canEdit, onClose, onDirtyChange, onOpenSimpleMode }: Props) {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const isLg = useIsLargeScreen();
  const isTablet = !isMobile && !isLg;
  const confirmUnsaved = useUnsavedChangesConfirm();
  const { workspaceId } = useActiveWorkspaceId();
  const save = useSaveDocumentTemplateLayout();
  const documentStyleQuery = useGetDocumentStyle();
  const documentType = (
    template.documentType === "act" ||
    template.documentType === "invoice" ||
    template.documentType === "estimate" ||
    template.documentType === "work_order"
      ? template.documentType
      : "work_order"
  ) as DocumentTemplateType;

  const initialLayout = useMemo(() => {
    if (template.layout && isCanvasDocumentLayout(template.layout)) {
      return parseCanvasDocumentLayout(template.layout) ?? defaultCanvasLayoutForType(documentType, t);
    }
    if (template.layout && isDocumentLayout(template.layout)) {
      return convertBlocksLayoutToCanvas(template.layout);
    }
    return defaultCanvasLayoutForType(documentType, t);
  }, [template.layout, documentType, t]);

  const [history, setHistory] = useState<CanvasHistory>(() => createHistory(initialLayout));
  const layout = history.present;
  const [name, setName] = useState(template.name);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(100);
  const [showGrid] = useState(true);
  const [showData, setShowData] = useState(false);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [previewEntityId, setPreviewEntityId] = useState(DEMO_PRINT_SOURCE_ID);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewCtx, setPreviewCtx] = useState(() =>
    demoPrintContext({
      documentType:
        template.documentType === "act" || template.documentType === "invoice"
          ? template.documentType
          : "work_order",
      locale: "en",
    }),
  );
  const [clipboard, setClipboard] = useState<CanvasElement[]>([]);
  const [sidePanel, setSidePanel] = useState<SidePanel>(isLg ? null : null);
  const [tabletPanel, setTabletPanel] = useState<"palette" | "properties">("palette");
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sheetViewportRef = useRef<HTMLDivElement | null>(null);
  /** State mirror of the viewport node so the fit-width effect re-runs once the (portal) dialog content mounts. */
  const [sheetViewportEl, setSheetViewportEl] = useState<HTMLDivElement | null>(null);
  const setSheetViewportNode = useCallback((node: HTMLDivElement | null) => {
    sheetViewportRef.current = node;
    setSheetViewportEl(node);
  }, []);
  const dragPayloadRef = useRef<PaletteDragPayload | null>(null);
  /** When true, ResizeObserver stops auto-fitting until the user clicks "Fit width". */
  const zoomLockedByUser = useRef(false);

  const baseline = useRef(cloneLayout(initialLayout));
  const dirty = !layoutsEqual(layout, baseline.current) || name !== template.name;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const themeColors = documentStyleQuery.data?.colors ?? null;
  const selected = layout.elements.filter((el) => selectedIds.includes(el.id));
  const { widthMm, heightMm } = pageSizeMm(layout.page.size, layout.page.orientation);
  const content = useMemo(
    () => contentBoxMm(widthMm, heightMm, layout.page.marginsMm),
    [widthMm, heightMm, layout.page.marginsMm],
  );
  const scale = zoom / 100;
  const unknownTokenHits = useMemo(() => findUnknownTokensInCanvasLayout(layout), [layout]);

  const commit = useCallback((next: CanvasDocumentLayout) => {
    setHistory((prev) => pushHistory(prev, next));
  }, []);

  const setElements = useCallback(
    (updater: (elements: CanvasElement[]) => CanvasElement[]) => {
      commit({ ...layout, elements: updater(layout.elements) });
    },
    [commit, layout],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );
  const [dragPayload, setDragPayload] = useState<PaletteDragPayload | null>(null);
  const [dropPreview, setDropPreview] = useState<{ xMm: number; yMm: number; wMm: number; hMm: number } | null>(
    null,
  );

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
    let cancelled = false;
    void (async () => {
      try {
        const ctx = isDemoPrintSource(previewEntityId)
          ? demoPrintContext({ documentType, locale: i18n.language || "en" })
          : isInvoice
            ? await buildInvoicePrintContext(previewEntityId, workspaceId)
            : await buildOrderPrintContext(previewEntityId, workspaceId, documentType);
        if (cancelled) return;
        setPreviewCtx(ctx);
        const body = await import("./renderCanvasLayout").then((m) =>
          m.renderCanvasLayoutToHtml(layout, ctx, {
            showCents: template.showCents,
            colors: themeColors,
          }),
        );
        const pageCss = canvasPageCss(layout);
        setPreviewHtml(buildPrintDocument(body, name, pageCss));
      } catch {
        if (!cancelled) {
          setPreviewHtml(null);
          setPreviewCtx(demoPrintContext({ documentType, locale: i18n.language || "en" }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewEntityId, layout, workspaceId, isInvoice, documentType, template.showCents, themeColors, name, i18n.language]);

  function mmFromClient(clientX: number, clientY: number): { xMm: number; yMm: number } | null {
    const sheet = sheetRef.current;
    if (!sheet) return null;
    const rect = sheet.getBoundingClientRect();
    return contentMmFromSheetClient(clientX, clientY, rect, MM_TO_PX, scale, content.marginsMm);
  }

  function dropPointFromDrag(
    event: { activatorEvent: Event; delta: { x: number; y: number } },
    size: { wMm: number; hMm: number },
  ) {
    const activator = event.activatorEvent as PointerEvent;
    if (!activator || typeof activator.clientX !== "number") return null;
    // Top-left of the preview ≈ pointer minus a small grab offset into the box.
    const endX = activator.clientX + event.delta.x;
    const endY = activator.clientY + event.delta.y;
    const point = mmFromClient(endX, endY);
    if (!point) return null;
    return dropPreviewBoxFromContentPoint(
      point,
      size,
      content.contentWidthMm,
      content.contentHeightMm,
      layout.gridMm,
      true,
    );
  }

  const selectionBounds = useMemo(() => {
    if (!selected.length) return null;
    const minX = Math.min(...selected.map((el) => el.xMm));
    const minY = Math.min(...selected.map((el) => el.yMm));
    const maxX = Math.max(...selected.map((el) => el.xMm + el.wMm));
    return { minX, minY, maxX, midX: (minX + maxX) / 2 };
  }, [selected]);

  function handleDragMove(event: DragMoveEvent) {
    const payload = (event.active.data.current ?? dragPayloadRef.current) as PaletteDragPayload | null;
    if (!payload || !canEdit) {
      setDropPreview(null);
      return;
    }
    const size = defaultPaletteElementSizeMm(payload);
    const box = dropPointFromDrag(event, size);
    setDropPreview(box);
  }

  function handleDragEnd(event: DragEndEvent) {
    const payload = (event.active.data.current ?? dragPayloadRef.current) as PaletteDragPayload | null;
    dragPayloadRef.current = null;
    setDragPayload(null);
    const preview = dropPreview;
    setDropPreview(null);
    if (!payload || !canEdit) return;
    const size = defaultPaletteElementSizeMm(payload);
    const snapped = preview ?? dropPointFromDrag(event, size);
    if (!snapped) return;
    const created = createCanvasElementFromPalette(payload, snapped.xMm, snapped.yMm);
    commit({ ...layout, elements: [...layout.elements, created] });
    setSelectedIds([created.id]);
  }

  function deleteSelectedElements() {
    if (!canEdit || !selectedIds.length) return;
    const lockedOnly = selected.every((el) => el.locked);
    if (lockedOnly) return;
    commit({
      ...layout,
      elements: layout.elements.filter((el) => !selectedIds.includes(el.id) || el.locked),
    });
    setSelectedIds((ids) => ids.filter((id) => layout.elements.find((el) => el.id === id)?.locked));
  }

  // Pointer move / resize
  const interactionRef = useRef<
    | { mode: "move"; startX: number; startY: number; origins: Array<{ id: string; xMm: number; yMm: number }> }
    | { mode: "resize"; handle: ResizeHandle; startX: number; startY: number; origin: CanvasElement }
    | null
  >(null);
  const dragStartLayoutRef = useRef<CanvasDocumentLayout | null>(null);

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
          content,
        );
        guidesNext = snapped.guides;
        const clamped = clampBoxToContent(
          { xMm: snapped.xMm, yMm: snapped.yMm, wMm: el.wMm, hMm: el.hMm },
          content.contentWidthMm,
          content.contentHeightMm,
        );
        return { ...el, xMm: clamped.xMm, yMm: clamped.yMm };
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
    const clamped = clampBoxToContent(
      {
        xMm: snapValue(xMm, layout.gridMm, true),
        yMm: snapValue(yMm, layout.gridMm, true),
        wMm: snapValue(wMm, layout.gridMm, true),
        hMm: snapValue(hMm, layout.gridMm, true),
      },
      content.contentWidthMm,
      content.contentHeightMm,
    );
    setHistory((prev) => ({
      ...prev,
      present: {
        ...prev.present,
        elements: prev.present.elements.map((el) => (el.id === o.id ? { ...el, ...clamped } : el)),
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
        if (tag === "INPUT" || tag === "TEXTAREA" || (event.target as HTMLElement)?.isContentEditable) return;
        event.preventDefault();
        deleteSelectedElements();
        return;
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && selectedIds.length) {
        event.preventDefault();
        const step = event.shiftKey ? layout.gridMm : 1;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        const box = contentBoxMm(widthMm, heightMm, layout.page.marginsMm);
        commit({
          ...layout,
          elements: layout.elements.map((el) => {
            if (!selectedIds.includes(el.id) || el.locked) return el;
            const clamped = clampBoxToContent(
              { xMm: el.xMm + dx, yMm: el.yMm + dy, wMm: el.wMm, hMm: el.hMm },
              box.contentWidthMm,
              box.contentHeightMm,
            );
            return { ...el, xMm: clamped.xMm, yMm: clamped.yMm };
          }),
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
      // Toast comes from the mutation onSuccess (also updates React Query cache).
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
    commit(defaultCanvasLayoutForType(documentType, t));
    setSelectedIds([]);
  }

  function applyFitWidth(availableWidthPx: number) {
    setZoom(computeFitWidthZoomPercent(availableWidthPx, widthMm));
  }

  function setZoomFromControl(next: number | ((current: number) => number)) {
    zoomLockedByUser.current = true;
    setZoom(next);
  }

  function fitWidthFromViewport() {
    const viewport = sheetViewportRef.current;
    if (!viewport) return;
    zoomLockedByUser.current = false;
    applyFitWidth(viewport.clientWidth);
  }

  const pageBg = fillToCss(layout.page.background, themeColors);

  const handles: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
  const handleSize = isMobile ? 24 : 8;
  const handleOffset = handleSize / 2;

  useEffect(() => {
    const viewport = sheetViewportEl;
    if (!viewport || typeof ResizeObserver === "undefined") return;

    const maybeFit = () => {
      if (zoomLockedByUser.current) return;
      const available = viewport.clientWidth;
      if (!needsFitWidth(available, widthMm)) return;
      setZoom(computeFitWidthZoomPercent(available, widthMm));
    };

    maybeFit();
    const observer = new ResizeObserver(() => maybeFit());
    observer.observe(viewport);
    const onOrientation = () => maybeFit();
    window.addEventListener("orientationchange", onOrientation);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", onOrientation);
    };
  }, [widthMm, sheetViewportEl]);

  /** Content-box CSS px (unscaled), matching element left/top inside the content container. */
  function contentPointFromClient(clientX: number, clientY: number): { x: number; y: number } | null {
    const contentEl = contentRef.current;
    if (!contentEl) return null;
    const rect = contentEl.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
    };
  }

  function finishMarquee(state: MarqueeState) {
    const left = Math.min(state.originX, state.x);
    const top = Math.min(state.originY, state.y);
    const right = Math.max(state.originX, state.x);
    const bottom = Math.max(state.originY, state.y);
    if (right - left < 2 && bottom - top < 2) {
      if (!state.additive) setSelectedIds([]);
      return;
    }
    const hit = layout.elements
      .filter((el) => {
        const elLeft = el.xMm * MM_TO_PX;
        const elTop = el.yMm * MM_TO_PX;
        const elRight = elLeft + el.wMm * MM_TO_PX;
        const elBottom = elTop + el.hMm * MM_TO_PX;
        return elLeft < right && elRight > left && elTop < bottom && elBottom > top;
      })
      .map((el) => el.id);
    setSelectedIds((prev) => (state.additive ? [...new Set([...prev, ...hit])] : hit));
  }

  function onSheetPointerDown(event: React.PointerEvent) {
    // Click in the margin gutter clears selection; rubber-band starts on the content box.
    if (event.target === sheetRef.current) {
      if (!event.shiftKey) setSelectedIds([]);
      return;
    }
  }

  function onContentPointerDown(event: React.PointerEvent) {
    if (event.target !== contentRef.current) return;
    const point = contentPointFromClient(event.clientX, event.clientY);
    if (!point) return;
    setMarquee({
      originX: point.x,
      originY: point.y,
      x: point.x,
      y: point.y,
      additive: event.shiftKey,
    });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onSheetPointerMove(event: React.PointerEvent) {
    if (marquee) {
      const point = contentPointFromClient(event.clientX, event.clientY);
      if (!point) return;
      setMarquee((current) => (current ? { ...current, x: point.x, y: point.y } : null));
      return;
    }
    onPointerMove(event);
  }

  function onSheetPointerUp(event: React.PointerEvent) {
    if (marquee) {
      finishMarquee(marquee);
      setMarquee(null);
      return;
    }
    onPointerUp();
    void event;
  }

  function addPaletteElement(payload: PaletteDragPayload) {
    if (!canEdit) return;
    const centerX = content.contentWidthMm / 2 - 20;
    const centerY = content.contentHeightMm / 2 - 10;
    const created = createCanvasElementFromPalette(
      payload,
      snapValue(Math.max(0, centerX), layout.gridMm, true),
      snapValue(Math.max(0, centerY), layout.gridMm, true),
    );
    commit({ ...layout, elements: [...layout.elements, created] });
    setSelectedIds([created.id]);
    setSidePanel(null);
  }

  const propertiesPanel = (
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
  );

  function renderElementPreview(el: CanvasElement) {
    const demoOpts = {
      showCents: template.showCents,
      currency: previewCtx.currency,
      locale: previewCtx.locale || i18n.language || "en",
    };
    if (el.type === "text") {
      if (showData) {
        return applyTemplateVariables(el.content, previewCtx, demoOpts).replace(/<[^>]*>/g, "");
      }
      return segmentTextWithVariables(el.content, t).map((segment, index) =>
        segment.kind === "text" ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <VariableChip key={`${segment.token}-${index}`} label={segment.label} known={segment.known} />
        ),
      );
    }
    if (el.type === "variable") {
      if (showData) {
        const value = applyTemplateVariables(el.token, previewCtx, demoOpts).replace(/<[^>]*>/g, "");
        return `${el.label ? `${el.label}: ` : ""}${value || "—"}`;
      }
      const resolved = resolveVariableLabel(el.token, t);
      return (
        <>
          {el.label ? <span className="mr-1 opacity-70">{el.label}:</span> : null}
          <VariableChip label={resolved.label} known={resolved.known} />
        </>
      );
    }
    if (el.type === "table") return t("settings.printTemplates.canvas.table");
    if (el.type === "totals") return t("settings.printTemplates.canvas.totals");
    if (el.type === "image") return t("settings.printTemplates.canvas.image");
    if (el.type === "signatures") return t("settings.printTemplates.canvas.signatures");
    if (el.type === "qr") return t("settings.printTemplates.canvas.qr");
    if (el.type === "pageNumber") return el.format ?? "N/M";
    if (el.type === "line") return null;
    if (el.type === "rect") return null;
    return null;
  }

  const sheetSurface = (
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
        className="relative touch-none bg-white"
        style={{
          width: widthMm * MM_TO_PX,
          height: heightMm * MM_TO_PX,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          background: pageBg ?? "#ffffff",
        }}
        onPointerDown={onSheetPointerDown}
        onPointerMove={onSheetPointerMove}
        onPointerUp={onSheetPointerUp}
      >
        <div
          ref={contentRef}
          className="absolute box-border overflow-hidden border border-dashed border-sky-400/50"
          style={{
            left: content.marginsMm * MM_TO_PX,
            top: content.marginsMm * MM_TO_PX,
            width: content.contentWidthMm * MM_TO_PX,
            height: content.contentHeightMm * MM_TO_PX,
            backgroundImage: showGrid
              ? `linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)`
              : undefined,
            backgroundSize: showGrid ? `${layout.gridMm * MM_TO_PX}px ${layout.gridMm * MM_TO_PX}px` : undefined,
          }}
          onPointerDown={onContentPointerDown}
        >
          {layout.elements
            .slice()
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((el) => {
              const isSelected = selectedIds.includes(el.id);
              const box =
                el.type === "rect"
                  ? {
                      reactStyle: rectElementReactStyle({
                        fill: el.fill ?? el.style.background,
                        border: el.border ?? el.style.border,
                        radiusMm: el.radiusMm ?? el.style.radiusMm,
                        colors: themeColors,
                      }),
                      wrapForAlign: false,
                      align: el.style.align,
                    }
                  : buildCanvasBoxStyle(el.style, themeColors, {
                      overflow: el.type === "totals" ? "visible" : "hidden",
                    });
              const preview = renderElementPreview(el);
              const inner = box.wrapForAlign ? (
                <div style={{ width: "100%", textAlign: box.align }}>{preview}</div>
              ) : (
                preview
              );
              return (
                <div
                  key={el.id}
                  className={`absolute ${isSelected ? "ring-2 ring-sky-500" : "hover:ring-1 hover:ring-sky-300"}`}
                  style={{
                    left: el.xMm * MM_TO_PX,
                    top: el.yMm * MM_TO_PX,
                    width: el.wMm * MM_TO_PX,
                    height: el.hMm * MM_TO_PX,
                    zIndex: el.zIndex,
                    cursor: el.locked ? "default" : "move",
                    ...box.reactStyle,
                    ...(el.type === "line"
                      ? {
                          borderTop:
                            el.orientation === "horizontal"
                              ? `${el.thicknessPt}pt solid ${fillToCss({ color: el.color }, themeColors) ?? "#000"}`
                              : undefined,
                          borderLeft:
                            el.orientation === "vertical"
                              ? `${el.thicknessPt}pt solid ${fillToCss({ color: el.color }, themeColors) ?? "#000"}`
                              : undefined,
                        }
                      : {}),
                  }}
                  onPointerDown={(event) => onElementPointerDown(event, el)}
                >
                  {inner}

                  {isSelected && !el.locked
                    ? handles.map((handle) => (
                        <div
                          key={handle}
                          className="absolute bg-sky-500"
                          style={{
                            width: handleSize,
                            height: handleSize,
                            left: handle.includes("w")
                              ? -handleOffset
                              : handle.includes("e")
                                ? `calc(100% - ${handleOffset}px)`
                                : `calc(50% - ${handleOffset}px)`,
                            top: handle.includes("n")
                              ? -handleOffset
                              : handle.includes("s")
                                ? `calc(100% - ${handleOffset}px)`
                                : `calc(50% - ${handleOffset}px)`,
                            cursor: `${handle}-resize`,
                          }}
                          onPointerDown={(event) => onResizePointerDown(event, el, handle)}
                        />
                      ))
                    : null}
                </div>
              );
            })}

          {dropPreview ? (
            <div
              className="pointer-events-none absolute border-2 border-dashed border-sky-500 bg-sky-500/15"
              data-testid="canvas-drop-preview"
              style={{
                left: dropPreview.xMm * MM_TO_PX,
                top: dropPreview.yMm * MM_TO_PX,
                width: dropPreview.wMm * MM_TO_PX,
                height: dropPreview.hMm * MM_TO_PX,
              }}
            />
          ) : null}

          {selectionBounds && canEdit ? (
            <div
              className="absolute z-50 flex -translate-x-1/2 -translate-y-full gap-0.5 rounded-md border border-border bg-background p-0.5 shadow-md"
              data-testid="canvas-selection-toolbar"
              style={{
                left: selectionBounds.midX * MM_TO_PX,
                top: selectionBounds.minY * MM_TO_PX - 4,
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={selected.every((el) => el.locked)}
                title={
                  selected.every((el) => el.locked)
                    ? t("settings.printTemplates.elementLocked")
                    : selected.length > 1
                      ? t("settings.printTemplates.deleteSelected", { count: selectedIds.length })
                      : t("settings.printTemplates.deleteElement")
                }
                aria-label={
                  selected.length > 1
                    ? t("settings.printTemplates.deleteSelected", { count: selectedIds.length })
                    : t("settings.printTemplates.deleteElement")
                }
                onClick={deleteSelectedElements}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ) : null}

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

          {marquee ? (
            <div
              className="pointer-events-none absolute border border-sky-500 bg-sky-500/10"
              style={{
                left: Math.min(marquee.originX, marquee.x),
                top: Math.min(marquee.originY, marquee.y),
                width: Math.abs(marquee.x - marquee.originX),
                height: Math.abs(marquee.y - marquee.originY),
              }}
            />
          ) : null}

          {layout.elements.length === 0 ? (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              {t("settings.printTemplates.canvas.dropHere")}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void handleClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="fixed inset-0 top-0 left-0 z-50 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{t("settings.printTemplates.canvas.designer")}</DialogTitle>
        <DndContext
          sensors={sensors}
          onDragStart={(event) => {
            const payload = (event.active.data.current as PaletteDragPayload) ?? null;
            dragPayloadRef.current = payload;
            setDragPayload(payload);
          }}
          onDragMove={handleDragMove}
          onDragCancel={() => {
            dragPayloadRef.current = null;
            setDragPayload(null);
            setDropPreview(null);
          }}
          onDragEnd={handleDragEnd}
        >
          <div className="flex h-full min-h-0 flex-col bg-background">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => void handleClose()} aria-label={t("common.back")}>
                <ArrowLeft />
              </Button>
              <Input
                className="min-w-0 max-w-[12rem] flex-1 sm:max-w-xs"
                value={name}
                disabled={!canEdit}
                onChange={(event) => setName(event.target.value)}
              />
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={history.past.length === 0}
                  aria-label={t("common.undo", { defaultValue: "Undo" })}
                  onClick={() => setHistory((h) => undoHistory(h))}
                >
                  <Undo2 />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={history.future.length === 0}
                  aria-label={t("common.redo", { defaultValue: "Redo" })}
                  onClick={() => setHistory((h) => redoHistory(h))}
                >
                  <Redo2 />
                </Button>
              </div>
              <div className="hidden items-center gap-2 md:flex">
                <Label className="text-xs">
                  {showData
                    ? t("settings.printTemplates.canvas.showData")
                    : t("settings.printTemplates.canvas.showFieldNames")}
                </Label>
                <Switch checked={showData} onCheckedChange={setShowData} />
                <Button type="button" size="sm" variant="outline" onClick={bringForward} disabled={!canEdit || !selectedIds.length}>
                  {t("settings.printTemplates.canvas.bringForward")}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={sendBackward} disabled={!canEdit || !selectedIds.length}>
                  {t("settings.printTemplates.canvas.sendBackward")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canEdit || !selectedIds.length || selected.every((el) => el.locked)}
                  title={
                    selected.length > 0 && selected.every((el) => el.locked)
                      ? t("settings.printTemplates.elementLocked")
                      : undefined
                  }
                  aria-label={
                    selected.length > 1
                      ? t("settings.printTemplates.deleteSelected", { count: selectedIds.length })
                      : t("settings.printTemplates.deleteElement")
                  }
                  onClick={deleteSelectedElements}
                >
                  <Trash2 />
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={resetDefault} disabled={!canEdit}>
                  {t("settings.printTemplates.resetDefault")}
                </Button>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label="Zoom out"
                  onClick={() => setZoomFromControl((z) => Math.max(35, z - 10))}
                >
                  <ZoomOut />
                </Button>
                <span className="w-10 text-center text-xs tabular-nums">{zoom}%</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label="Zoom in"
                  onClick={() => setZoomFromControl((z) => Math.min(200, z + 10))}
                >
                  <ZoomIn />
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={fitWidthFromViewport}>
                  {t("settings.printTemplates.canvas.fitWidth")}
                </Button>
              </div>
              {isTablet ? (
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={tabletPanel === "palette" ? "default" : "outline"}
                    onClick={() => setTabletPanel("palette")}
                  >
                    {t("settings.printTemplates.canvas.elements")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={tabletPanel === "properties" ? "default" : "outline"}
                    onClick={() => setTabletPanel("properties")}
                  >
                    {t("settings.printTemplates.canvas.properties")}
                  </Button>
                </div>
              ) : null}
              <div className="ml-auto flex gap-2">
                <Select value={previewEntityId} onValueChange={setPreviewEntityId}>
                  <SelectTrigger className="hidden w-48 lg:flex" aria-label={t("settings.printTemplates.previewSource")}>
                    <SelectValue placeholder={t("settings.printTemplates.demoData")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEMO_PRINT_SOURCE_ID}>{t("settings.printTemplates.demoData")}</SelectItem>
                    {(isInvoice ? recentInvoicesQuery.data : recentOrdersQuery.data)?.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {"orderNumber" in item ? item.orderNumber : item.invoiceNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {onOpenSimpleMode ? (
                  <Button type="button" size="sm" variant="ghost" className="hidden sm:inline-flex" onClick={onOpenSimpleMode}>
                    {t("settings.printTemplates.canvas.simpleMode")}
                  </Button>
                ) : null}
                <Button type="button" disabled={!canEdit || save.isPending} onClick={() => void handleSave()}>
                  {t("settings.printTemplates.save")}
                </Button>
              </div>
            </div>

            {unknownTokenHits.length > 0 ? (
              <div
                role="status"
                className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100"
              >
                <p className="font-medium">{t("settings.printTemplates.variables.unknownTitle")}</p>
                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {unknownTokenHits.map((hit) => (
                    <li key={`${hit.token}-${hit.location}`}>
                      {t("settings.printTemplates.variables.unknownWithElement", {
                        token: hit.token,
                        element: hit.location,
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div
              className={cn(
                "grid min-h-0 flex-1",
                isLg ? "grid-cols-[220px_minmax(0,1fr)_280px]" : isTablet ? "grid-cols-[220px_minmax(0,1fr)]" : "grid-cols-1",
              )}
            >
              {isLg || isTablet ? (
                <div className="min-h-0 overflow-hidden border-r border-border">
                  {isLg || tabletPanel === "palette" ? (
                    <CanvasPalette onAddElement={isMobile ? addPaletteElement : undefined} />
                  ) : (
                    propertiesPanel
                  )}
                </div>
              ) : null}

              <div ref={setSheetViewportNode} className="min-h-0 min-w-0 overflow-auto bg-muted/30 p-2 sm:p-4">
                {sheetSurface}
                {previewHtml ? (
                  <iframe title="preview" className="mt-3 hidden h-48 w-full rounded-md border border-border bg-white lg:block" srcDoc={previewHtml} />
                ) : null}
              </div>

              {isLg ? <div className="min-h-0 overflow-hidden border-l border-border">{propertiesPanel}</div> : null}
            </div>

            {isMobile ? (
              <div className="flex shrink-0 items-center gap-2 border-t border-border px-2 py-2">
                <Button type="button" size="sm" variant="outline" className="min-w-0 flex-1" onClick={() => setSidePanel("palette")}>
                  {t("settings.printTemplates.canvas.elements")}
                </Button>
                <Button type="button" size="sm" variant="outline" className="min-w-0 flex-1" onClick={() => setSidePanel("properties")}>
                  {t("settings.printTemplates.canvas.properties")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="sm" variant="outline" aria-label={t("common.actions")}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    <DropdownMenuItem disabled={!canEdit || !selectedIds.length} onSelect={() => bringForward()}>
                      {t("settings.printTemplates.canvas.bringForward")}
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={!canEdit || !selectedIds.length} onSelect={() => sendBackward()}>
                      {t("settings.printTemplates.canvas.sendBackward")}
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={!canEdit} onSelect={() => resetDefault()}>
                      {t("settings.printTemplates.resetDefault")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : null}
          </div>

          <Sheet open={sidePanel === "palette"} onOpenChange={(open) => setSidePanel(open ? "palette" : null)}>
            <SheetContent side="bottom" className="h-[70vh] max-h-[70vh] overflow-hidden p-0">
              <SheetHeader className="px-4 pt-4">
                <SheetTitle>{t("settings.printTemplates.canvas.elements")}</SheetTitle>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-auto px-2 pb-4">
                <CanvasPalette onAddElement={addPaletteElement} />
              </div>
            </SheetContent>
          </Sheet>

          <Sheet open={sidePanel === "properties"} onOpenChange={(open) => setSidePanel(open ? "properties" : null)}>
            <SheetContent side="bottom" className="h-[70vh] max-h-[70vh] overflow-hidden p-0">
              <SheetHeader className="px-4 pt-4">
                <SheetTitle>{t("settings.printTemplates.canvas.properties")}</SheetTitle>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-auto">{propertiesPanel}</div>
            </SheetContent>
          </Sheet>

          <DragOverlay dropAnimation={null}>
            {dragPayload ? (
              <div className="rounded-md border border-sky-400 bg-white px-2 py-1 text-xs shadow-md">
                {dragPayload.kind === "variable"
                  ? dragPayload.label || dragPayload.token
                  : t(`settings.printTemplates.canvas.${dragPayload.elementType === "rect" ? "coloredArea" : dragPayload.elementType}`, {
                      defaultValue: dragPayload.elementType,
                    })}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </DialogContent>
    </Dialog>
  );
}

/** Helper used by settings to detect canvas layouts. */
export function templateIsCanvas(template: DocumentTemplate): boolean {
  return isCanvasDocumentLayout(template.layout);
}

export { convertBlocksLayoutToCanvas };
