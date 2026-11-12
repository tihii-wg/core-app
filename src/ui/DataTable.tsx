import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  defaultAnnouncements,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/Table";
import { Skeleton } from "../ui/Skeleton";
import {
  TABLE_COLUMN_MAX_WIDTH,
  TABLE_COLUMN_MIN_WIDTH,
  TABLE_COLUMN_WIDTH_STEP,
  TABLE_COLUMN_WIDTH_STEP_LARGE,
  clampColumnWidth,
  applyVisibleColumnReorder,
  clearTableColumnLayout,
  readTableColumnLayout,
  resolveTableColumnLayout,
  writeTableColumnLayout,
  type TableColumnLayout,
} from "./tableColumnLayout";

export interface Column<T> {
  key: string;
  /** Stable id for layout persistence; defaults to `key`. */
  id?: string;
  header: string;
  cell: (item: T) => React.ReactNode;
  className?: string;
  /** Pin the column to the right edge while the rest of the table scrolls horizontally (opt-in per table). */
  stickyRight?: boolean;
  /** Default width in px when layout/resize is enabled. */
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  /** When false, the column cannot be resized (default true if table `resizable`). */
  resizable?: boolean;
  /** When false, the column cannot be reordered (default true if table `reorderable`). */
  reorderable?: boolean;
  /** Absorbs leftover width when the table is wider than the sum of column widths. */
  flexible?: boolean;
}

const stickyHeadClassName = "sticky right-0 z-20 bg-muted shadow-[-10px_0_14px_-10px_rgb(10_14_20/0.25)]";
const stickyCellClassName = "sticky right-0 z-10 bg-card shadow-[-10px_0_14px_-10px_rgb(10_14_20/0.18)]";

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  onRowClick?: (item: T) => void;
  rowClassName?: (item: T) => string | undefined;
  isLoading?: boolean;
  emptyState?: React.ReactNode;
  className?: string;
  /** Enable column resize handles. */
  resizable?: boolean;
  /** Enable header drag-to-reorder (dnd-kit). */
  reorderable?: boolean;
  /** Persist order + widths under this localStorage key. */
  layoutStorageKey?: string;
  /** Bump to re-read layout from storage (e.g. after «reset layout»). */
  layoutEpoch?: number;
  /** Column id that expands when the table is wider than the sum of widths. */
  flexibleColumnId?: string;
  /** Column ids forced to stay at the end (not draggable). */
  pinnedEndColumnIds?: readonly string[];
}

const frameClassName = "bg-card min-w-0 overflow-hidden rounded-lg border border-border shadow-xs";
const skeletonWidths = ["w-3/4", "w-1/2", "w-2/3", "w-5/12", "w-7/12"];

function columnIdOf<T>(column: Column<T>): string {
  return column.id ?? column.key;
}

type HeaderChromeProps = {
  id: string;
  label: string;
  resizable: boolean;
  reorderable: boolean;
  widthLabel: string;
  onResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onResizeDoubleClick: () => void;
  isDragging?: boolean;
};

function HeaderChrome({
  id,
  label,
  resizable,
  reorderable,
  widthLabel,
  onResizePointerDown,
  onResizeKeyDown,
  onResizeDoubleClick,
  isDragging,
}: HeaderChromeProps) {
  return (
    <div className={cn("relative flex h-full min-h-10 items-center gap-1 pr-2", isDragging && "opacity-60")}>
      <span className={cn("min-w-0 flex-1 truncate", reorderable && "cursor-grab active:cursor-grabbing")}>{label}</span>
      {resizable ? (
        <button
          type="button"
          data-testid={`col-resize-${id}`}
          data-row-click-ignore
          aria-label={widthLabel}
          title={widthLabel}
          className={cn(
            "absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none",
            "opacity-0 hover:opacity-100 focus-visible:opacity-100",
            "after:absolute after:inset-y-1 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border",
            "hover:after:bg-primary focus-visible:after:bg-primary",
            "focus-visible:outline-none",
          )}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => {
            event.stopPropagation();
            onResizePointerDown(event);
          }}
          onKeyDown={onResizeKeyDown}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onResizeDoubleClick();
          }}
        />
      ) : null}
    </div>
  );
}

type SortableHeadProps = {
  id: string;
  disabled: boolean;
  className?: string;
  label: string;
  chrome: ReactNode;
};

function SortableHead({ id, disabled, className, label, chrome }: SortableHeadProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  };
  // Keep the <th> as a columnheader; put dnd listeners/keyboard attrs on an inner control
  // so we do not override the header role (dnd-kit defaults role="button").
  const { role: _role, ...dndAttributes } = attributes;
  void _role;
  return (
    <TableHead
      ref={setNodeRef}
      style={style}
      className={cn(className, isDragging && "bg-muted")}
      data-col-id={id}
      aria-label={label}
    >
      <div className="min-w-0" {...dndAttributes} {...(disabled ? {} : listeners)}>
        {chrome}
      </div>
    </TableHead>
  );
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  rowClassName,
  isLoading,
  emptyState,
  className,
  resizable = false,
  reorderable = false,
  layoutStorageKey,
  layoutEpoch = 0,
  flexibleColumnId,
  pinnedEndColumnIds = [],
}: DataTableProps<T>) {
  const { t, i18n } = useTranslation();
  const layoutEnabled = Boolean(resizable || reorderable || layoutStorageKey);

  const defaultWidths = useMemo(() => {
    const map = new Map<string, number>();
    for (const column of columns) {
      map.set(columnIdOf(column), column.defaultWidth ?? 120);
    }
    return map;
  }, [columns]);

  const minWidths = useMemo(() => {
    const map = new Map<string, number>();
    for (const column of columns) {
      map.set(columnIdOf(column), column.minWidth ?? TABLE_COLUMN_MIN_WIDTH);
    }
    return map;
  }, [columns]);

  const columnIds = useMemo(() => columns.map(columnIdOf), [columns]);
  const columnById = useMemo(() => {
    const map = new Map<string, Column<T>>();
    for (const column of columns) map.set(columnIdOf(column), column);
    return map;
  }, [columns]);

  const flexId = flexibleColumnId ?? columns.find((column) => column.flexible)?.id ?? columns.find((column) => column.flexible)?.key;

  const [layout, setLayout] = useState<TableColumnLayout>(() => {
    if (!layoutEnabled) {
      return { order: columnIds, widths: Object.fromEntries(defaultWidths) };
    }
    const stored = layoutStorageKey ? readTableColumnLayout(layoutStorageKey) : null;
    return resolveTableColumnLayout({
      columnIds,
      defaultWidths,
      minWidths,
      stored,
      pinnedEndIds: pinnedEndColumnIds,
    });
  });

  // Re-resolve when columns change (visibility) or storage is reset via layoutEpoch.
  useEffect(() => {
    if (!layoutEnabled) {
      setLayout({ order: columnIds, widths: Object.fromEntries(defaultWidths) });
      return;
    }
    const stored = layoutStorageKey ? readTableColumnLayout(layoutStorageKey) : null;
    setLayout(
      resolveTableColumnLayout({
        columnIds,
        defaultWidths,
        minWidths,
        stored,
        pinnedEndIds: pinnedEndColumnIds,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional reload on epoch / column id set
  }, [layoutEpoch, columnIds.join("|"), layoutStorageKey, layoutEnabled]);

  const orderedColumns = useMemo(() => {
    if (!layoutEnabled) return columns;
    const byId = columnById;
    const ordered: Column<T>[] = [];
    for (const id of layout.order) {
      const column = byId.get(id);
      if (column) ordered.push(column);
    }
    for (const column of columns) {
      if (!ordered.includes(column)) ordered.push(column);
    }
    return ordered;
  }, [columns, columnById, layout.order, layoutEnabled]);

  const orderedIds = useMemo(() => orderedColumns.map(columnIdOf), [orderedColumns]);

  const persistLayout = useCallback(
    (next: { order: string[]; widths: Record<string, number> }) => {
      const previous = layoutStorageKey ? readTableColumnLayout(layoutStorageKey) : null;
      const fullOrder = applyVisibleColumnReorder(
        previous?.order?.length ? previous.order : next.order,
        next.order,
        pinnedEndColumnIds,
      );
      const fullWidths = { ...(previous?.widths ?? {}), ...next.widths };
      const stored: TableColumnLayout = { order: fullOrder, widths: fullWidths };
      setLayout({
        order: next.order,
        widths: next.widths,
      });
      if (layoutStorageKey) writeTableColumnLayout(layoutStorageKey, stored);
    },
    [layoutStorageKey, pinnedEndColumnIds],
  );

  const colRefs = useRef(new Map<string, HTMLTableColElement>());
  const tableRef = useRef<HTMLTableElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widthsRef = useRef(layout.widths);
  widthsRef.current = layout.widths;

  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(width);
    });
    ro.observe(node);
    setContainerWidth(node.clientWidth);
    return () => ro.disconnect();
  }, [layoutEnabled]);

  const displayWidths = useMemo(() => {
    const widths = { ...layout.widths };
    if (!layoutEnabled || !flexId || !(flexId in widths)) return widths;
    let sum = 0;
    for (const id of orderedIds) sum += widths[id] ?? 0;
    if (containerWidth > sum + 1) {
      const others = sum - (widths[flexId] ?? 0);
      widths[flexId] = Math.max(widths[flexId] ?? 0, Math.floor(containerWidth - others));
    }
    return widths;
  }, [layout.widths, layoutEnabled, flexId, orderedIds, containerWidth]);

  const tableMinWidth = useMemo(() => {
    let sum = 0;
    for (const id of orderedIds) sum += layout.widths[id] ?? 0;
    return sum;
  }, [orderedIds, layout.widths]);

  const applyColWidth = useCallback((id: string, width: number) => {
    const col = colRefs.current.get(id);
    if (col) col.style.width = `${width}px`;
  }, []);

  const commitWidths = useCallback(
    (nextWidths: Record<string, number>) => {
      persistLayout({ order: layout.order, widths: nextWidths });
    },
    [layout.order, persistLayout],
  );

  const resizeColumn = useCallback(
    (id: string, nextWidth: number, commit: boolean) => {
      const column = columnById.get(id);
      if (!column || column.resizable === false) return;
      const min = column.minWidth ?? TABLE_COLUMN_MIN_WIDTH;
      const max = column.maxWidth ?? TABLE_COLUMN_MAX_WIDTH;
      const clamped = clampColumnWidth(nextWidth, min, max);
      applyColWidth(id, clamped);
      const draft = { ...widthsRef.current, [id]: clamped };
      widthsRef.current = draft;
      if (tableRef.current) {
        let sum = 0;
        for (const colId of orderedIds) sum += draft[colId] ?? 0;
        tableRef.current.style.minWidth = `${sum}px`;
      }
      if (commit) commitWidths(draft);
    },
    [applyColWidth, columnById, commitWidths, orderedIds],
  );

  const onResizePointerDown = useCallback(
    (id: string, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!resizable) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startWidth = widthsRef.current[id] ?? defaultWidths.get(id) ?? 120;

      const onMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startX;
        resizeColumn(id, startWidth + delta, false);
      };
      const onUp = (upEvent: PointerEvent) => {
        handle.releasePointerCapture(upEvent.pointerId);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        const delta = upEvent.clientX - startX;
        resizeColumn(id, startWidth + delta, true);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [defaultWidths, resizable, resizeColumn],
  );

  const onResizeKeyDown = useCallback(
    (id: string, event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const step = event.shiftKey ? TABLE_COLUMN_WIDTH_STEP_LARGE : TABLE_COLUMN_WIDTH_STEP;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        resizeColumn(id, (widthsRef.current[id] ?? 120) - step, true);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        resizeColumn(id, (widthsRef.current[id] ?? 120) + step, true);
      }
    },
    [resizeColumn],
  );

  const resetColumnWidth = useCallback(
    (id: string) => {
      const fallback = defaultWidths.get(id) ?? 120;
      resizeColumn(id, fallback, true);
    },
    [defaultWidths, resizeColumn],
  );

  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sortableIds = useMemo(
    () =>
      orderedIds.filter((id) => {
        const column = columnById.get(id);
        if (!column) return false;
        if (pinnedEndColumnIds.includes(id)) return false;
        return column.reorderable !== false;
      }),
    [orderedIds, columnById, pinnedEndColumnIds],
  );

  const onDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = orderedIds.indexOf(String(active.id));
      const newIndex = orderedIds.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;
      const overColumn = columnById.get(String(over.id));
      if (overColumn?.reorderable === false || pinnedEndColumnIds.includes(String(over.id))) return;
      const nextOrder = arrayMove(orderedIds, oldIndex, newIndex);
      // Keep pinned end columns at the end.
      const pinned = pinnedEndColumnIds.filter((id) => nextOrder.includes(id));
      const movable = nextOrder.filter((id) => !pinnedEndColumnIds.includes(id));
      persistLayout({ order: [...movable, ...pinned], widths: layout.widths });
    },
    [orderedIds, columnById, pinnedEndColumnIds, persistLayout, layout.widths],
  );

  const announcements = useMemo(() => {
    const locale = i18n.language?.startsWith("ru")
      ? "ru"
      : i18n.language?.startsWith("ro")
        ? "ro"
        : "en";
    // Prefer translated strings; Russian copy matches the product requirement for announcements.
    void locale;
    return {
      onDragStart({ active }: { active: { id: string | number } }) {
        return t("common.tableLayout.lifted", { column: columnById.get(String(active.id))?.header ?? active.id });
      },
      onDragOver({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) {
        if (!over) return t("common.tableLayout.noDrop");
        return t("common.tableLayout.movedOver", {
          column: columnById.get(String(active.id))?.header ?? active.id,
          over: columnById.get(String(over.id))?.header ?? over.id,
        });
      },
      onDragEnd({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) {
        if (!over) return t("common.tableLayout.cancelled", { column: columnById.get(String(active.id))?.header ?? active.id });
        return t("common.tableLayout.dropped", {
          column: columnById.get(String(active.id))?.header ?? active.id,
          over: columnById.get(String(over.id))?.header ?? over.id,
        });
      },
      onDragCancel({ active }: { active: { id: string | number } }) {
        return t("common.tableLayout.cancelled", { column: columnById.get(String(active.id))?.header ?? active.id });
      },
    };
  }, [t, i18n.language, columnById]);

  // Keep <col> styles in sync when React widths change (not during live drag).
  useLayoutEffect(() => {
    if (!layoutEnabled) return;
    for (const id of orderedIds) {
      applyColWidth(id, displayWidths[id] ?? layout.widths[id] ?? 120);
    }
    if (tableRef.current) tableRef.current.style.minWidth = `${tableMinWidth}px`;
  }, [layoutEnabled, orderedIds, displayWidths, layout.widths, tableMinWidth, applyColWidth]);

  const renderHeaderCell = (column: Column<T>) => {
    const id = columnIdOf(column);
    const canResize = resizable && column.resizable !== false;
    const canReorder = reorderable && column.reorderable !== false && !pinnedEndColumnIds.includes(id);
    const widthLabel = t("common.tableLayout.resizeColumn", { column: column.header });
    const chrome = (
      <HeaderChrome
        id={id}
        label={column.header}
        resizable={canResize}
        reorderable={canReorder}
        widthLabel={widthLabel}
        onResizePointerDown={(event) => onResizePointerDown(id, event)}
        onResizeKeyDown={(event) => onResizeKeyDown(id, event)}
        onResizeDoubleClick={() => resetColumnWidth(id)}
      />
    );
    const headClass = cn(
      column.className,
      column.stickyRight && stickyHeadClassName,
      layoutEnabled && "sticky top-0 z-[15] bg-muted",
      layoutEnabled && "overflow-hidden",
    );

    if (reorderable && canReorder) {
      return (
        <SortableHead
          key={id}
          id={id}
          disabled={false}
          className={headClass}
          label={column.header}
          chrome={chrome}
        />
      );
    }
    return (
      <TableHead key={id} className={headClass} data-col-id={id}>
        {layoutEnabled ? chrome : column.header}
      </TableHead>
    );
  };

  const colgroup =
    layoutEnabled ? (
      <colgroup>
        {orderedColumns.map((column) => {
          const id = columnIdOf(column);
          return (
            <col
              key={id}
              data-col-id={id}
              ref={(el) => {
                if (el) colRefs.current.set(id, el);
                else colRefs.current.delete(id);
              }}
              style={{ width: displayWidths[id] ?? layout.widths[id] }}
            />
          );
        })}
      </colgroup>
    ) : null;

  const headerRow = (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        {orderedColumns.map((column) => renderHeaderCell(column))}
      </TableRow>
    </TableHeader>
  );

  // Narrowed columns just cut their text at the edge (no "…", no wrapping, row height never changes).
  const tableClassName = cn(layoutEnabled && "table-fixed data-clip-cells [&_td_*]:whitespace-nowrap [&_th_*]:whitespace-nowrap [&_td_*]:text-clip [&_th_*]:text-clip");
  const tableStyle: CSSProperties | undefined = layoutEnabled
    ? { minWidth: tableMinWidth, width: "100%" }
    : undefined;

  const bodyRows = (cols: Column<T>[]) =>
    data?.map((item) => (
      <TableRow
        key={keyExtractor(item)}
        onClick={(event) => {
          if (isRowClickIgnored(event.target)) return;
          onRowClick?.(item);
        }}
        className={cn(rowClassName?.(item), onRowClick && "cursor-pointer hover:bg-accent/60")}
      >
        {cols.map((column) => {
          const id = columnIdOf(column);
          const content = column.cell(item);
          return (
            <TableCell
              key={column.key}
              className={cn(
                "h-12 text-sm text-foreground",
                layoutEnabled && "max-w-0 overflow-hidden",
                column.className,
                column.stickyRight && stickyCellClassName,
              )}
            >
              {content}
            </TableCell>
          );
        })}
      </TableRow>
    ));

  const skeletonBody = (
    <TableBody>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableRow key={i} className="hover:bg-transparent">
          {orderedColumns.map((column, c) => (
            <TableCell
              key={column.key}
              className={cn("h-12", column.className, column.stickyRight && stickyCellClassName)}
            >
              <Skeleton className={cn("h-3.5", skeletonWidths[(i + c) % skeletonWidths.length])} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );

  const tableInner = (body: ReactNode) => (
    <div ref={containerRef} className="min-w-0">
      <Table ref={tableRef} className={tableClassName} style={tableStyle}>
        {colgroup}
        {headerRow}
        {body}
      </Table>
    </div>
  );

  let main: ReactNode;
  if (isLoading) {
    main = (
      <div className={cn(frameClassName, className)} aria-busy="true">
        {tableInner(skeletonBody)}
      </div>
    );
  } else if (data?.length === 0 && emptyState) {
    main = <div className={cn(frameClassName, className)}>{emptyState}</div>;
  } else {
    main = (
      <div className={cn(frameClassName, className)}>{tableInner(<TableBody>{bodyRows(orderedColumns)}</TableBody>)}</div>
    );
  }

  if (!reorderable || !layoutEnabled) return main;

  const activeColumn = activeDragId ? columnById.get(activeDragId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveDragId(null)}
      accessibility={{ announcements: { ...defaultAnnouncements, ...announcements } }}
    >
      <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
        {main}
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeColumn ? (
          <div className="rounded-md border border-border bg-muted px-3 py-2 text-xs font-medium shadow-md">
            {activeColumn.header}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** True when the click started on an element that handles its own tap (e.g. price breakdown). */
export function isRowClickIgnored(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-row-click-ignore]") != null;
}

/** Test helper / menu action: clear persisted layout for a storage key. */
export function resetDataTableLayout(storageKey: string): void {
  clearTableColumnLayout(storageKey);
}
