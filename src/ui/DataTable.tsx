

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
  isLoading?: boolean;
  emptyState?: React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  isLoading,
  emptyState,
  className,
}: DataTableProps<T>) {


  if (isLoading) {
    return (
      <div className={cn('bg-white rounded-md border border-[#eeeeef]', className)}>
        <Table>
          <TableHeader>
            <TableRow className="border-[#eeeeef] hover:bg-transparent">
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn('text-[#939699] font-medium text-xs h-10', column.className)}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i} className="border-[#eeeeef]">
                {columns?.map((column) => (
                  <TableCell key={column.key} className={column.className}>
                    <Skeleton className="h-4 w-full" />
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
    return (
      <div className={cn('bg-white rounded-md border border-[#eeeeef]', className)}>
        {emptyState}
      </div>
    );
  }

  return (
    <div className={cn('bg-white rounded-md border border-[#eeeeef] overflow-x-auto', className)}>
      <Table>
        <TableHeader>
          <TableRow className="border-[#eeeeef] hover:bg-transparent">
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={cn('text-[#939699] font-medium text-xs h-10 whitespace-nowrap', column.className)}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.map((item) => (
            <TableRow
              key={keyExtractor(item)}
              onClick={() => onRowClick?.(item)}
              className={cn(
                'border-[#eeeeef]',
                onRowClick && 'cursor-pointer hover:bg-[#edf4fd]'
              )}
            >
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn('text-sm text-[#282e33] py-3', column.className)}
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
