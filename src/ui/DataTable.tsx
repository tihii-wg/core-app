import { cn } from '../lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/Table';
import { Skeleton } from '../ui/Skeleton';

export interface Column<T> {
  key: string;
  header: string;
  cell: (item: T) => React.ReactNode;
  className?: string;
  /** Pin the column to the right edge while the rest of the table scrolls horizontally (opt-in per table). */
  stickyRight?: boolean;
}

const stickyHeadClassName = 'sticky right-0 z-20 bg-muted shadow-[-10px_0_14px_-10px_rgb(10_14_20/0.25)]';
const stickyCellClassName = 'sticky right-0 z-10 bg-card shadow-[-10px_0_14px_-10px_rgb(10_14_20/0.18)]';

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  onRowClick?: (item: T) => void;
  rowClassName?: (item: T) => string | undefined;
  isLoading?: boolean;
  emptyState?: React.ReactNode;
  className?: string;
}

const frameClassName = 'bg-card min-w-0 overflow-hidden rounded-lg border border-border shadow-xs';
const skeletonWidths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/12', 'w-7/12'];

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  rowClassName,
  isLoading,
  emptyState,
  className,
}: DataTableProps<T>) {
  const header = (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        {columns.map((column) => (
          <TableHead key={column.key} className={cn(column.className, column.stickyRight && stickyHeadClassName)}>
            {column.header}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );

  if (isLoading) {
    return (
      <div className={cn(frameClassName, className)} aria-busy="true">
        <Table>
          {header}
          <TableBody>
            {Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i} className="hover:bg-transparent">
                {columns.map((column, c) => (
                  <TableCell key={column.key} className={cn('h-12', column.className, column.stickyRight && stickyCellClassName)}>
                    <Skeleton className={cn('h-3.5', skeletonWidths[(i + c) % skeletonWidths.length])} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (data?.length === 0 && emptyState) {
    return <div className={cn(frameClassName, className)}>{emptyState}</div>;
  }

  return (
    <div className={cn(frameClassName, className)}>
      <Table>
        {header}
        <TableBody>
          {data?.map((item) => (
            <TableRow
              key={keyExtractor(item)}
              onClick={() => onRowClick?.(item)}
              className={cn(rowClassName?.(item), onRowClick && 'cursor-pointer hover:bg-accent/60')}
            >
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn('h-12 text-sm text-foreground', column.className, column.stickyRight && stickyCellClassName)}
                >
                  {column.cell(item)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
