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
}

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
          <TableHead key={column.key} className={column.className}>
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
                  <TableCell key={column.key} className={cn('h-12', column.className)}>
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
                  className={cn('h-12 text-sm text-foreground', column.className)}
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
