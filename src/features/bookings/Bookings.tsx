import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Column } from "../../ui/DataTable";
import { StatusBadge } from "../../ui/StatusBadge";
import type { BookingRecord, BookingStatus } from "../../services/apiBookings";
import { DateCell, Stage9ListPage } from "../stage9/Stage9ListPage";
import { BookingFormDialog } from "./BookingFormDialog";
import { useGetBookings } from "./useGetBookings";
import { useDeleteBooking } from "./useBookingMutations";

const statusVariants: Record<BookingStatus, "info" | "success" | "muted" | "danger" | "warning"> = {
  scheduled: "info",
  confirmed: "success",
  completed: "muted",
  canceled: "danger",
  no_show: "warning",
};

export function Bookings() {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useGetBookings();
  const deleteBooking = useDeleteBooking();
  const [addOpen, setAddOpen] = useState(false);

  const columns: Column<BookingRecord>[] = [
    {
      key: "id",
      header: t("stage9.columns.id"),
      className: "w-[120px] whitespace-nowrap",
      cell: (booking) => <span className="font-mono text-xs text-muted-foreground">{booking.id.slice(0, 8)}</span>,
    },
    {
      key: "title",
      header: t("stage9.columns.title"),
      cell: (booking) => (
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            <DateCell value={booking.startsAt} withTime />
          </p>
          <p className="max-w-[28rem] truncate text-xs text-muted-foreground">
            {t(`stage9.bookings.sources.${booking.source}`)}
            {booking.comment ? ` · ${booking.comment}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: t("common.status"),
      cell: (booking) => (
        <StatusBadge variant={statusVariants[booking.status]} dot>
          {t(`stage9.bookings.statuses.${booking.status}`)}
        </StatusBadge>
      ),
    },
    {
      key: "ends",
      header: t("stage9.bookings.endsAt"),
      className: "hidden md:table-cell",
      cell: (booking) => <DateCell value={booking.endsAt} withTime />,
    },
    {
      key: "created",
      header: t("stage9.columns.createdAt"),
      className: "hidden lg:table-cell",
      cell: (booking) => <DateCell value={booking.createdAt} />,
    },
  ];

  return (
    <>
      <Stage9ListPage
        module="bookings"
        table="bookings"
        icon={CalendarClock}
        columns={columns}
        keyExtractor={(booking) => booking.id}
        data={data}
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        onAdd={() => setAddOpen(true)}
        onDelete={(booking) => deleteBooking.mutate(booking.id)}
        rowLabel={(booking) => booking.comment ?? booking.startsAt.slice(0, 16).replace("T", " ")}
        isMutating={deleteBooking.isPending}
      />
      <BookingFormDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
