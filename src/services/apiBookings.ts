import i18n from "../i18n";
import { deleteStage9Row, insertStage9Row, listStage9Rows, nullIfBlank, str } from "./apiStage9List";

export type BookingStatus = "scheduled" | "confirmed" | "completed" | "canceled" | "no_show";
export type BookingSource = "manual" | "online";

export type BookingRecord = {
  id: string;
  startsAt: string;
  endsAt: string | null;
  status: BookingStatus;
  source: BookingSource;
  comment: string | null;
  createdAt: string;
};

const bookingColumns = "id, starts_at, ends_at, status, source, comment, created_at";
const bookingStatuses: readonly BookingStatus[] = ["scheduled", "confirmed", "completed", "canceled", "no_show"];

export function toBooking(row: Record<string, unknown>): BookingRecord {
  return {
    id: String(row.id),
    startsAt: typeof row.starts_at === "string" ? row.starts_at : "",
    endsAt: str(row.ends_at),
    status: bookingStatuses.find((status) => status === row.status) ?? "scheduled",
    source: row.source === "online" ? "online" : "manual",
    comment: str(row.comment),
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

/** Lists bookings, soonest first. Resolves to `isUnavailable` when `bookings` is not applied. */
export function getBookings(workspaceId: string | undefined) {
  return listStage9Rows("bookings", bookingColumns, workspaceId, "starts_at", true, toBooking);
}

export type BookingInput = {
  /** ISO timestamp (required). */
  startsAt: string;
  /** ISO timestamp, or null/blank for open-ended. */
  endsAt: string | null;
  comment: string;
};

const MAX_BOOKING_COMMENT = 1000;

/** Validates a booking form and builds the insert row (status `scheduled`, source `manual`). Pure. */
export function buildBookingRow(input: BookingInput) {
  const startsAt = input.startsAt?.trim() ?? "";
  const start = new Date(startsAt);
  if (!startsAt || Number.isNaN(start.getTime())) throw new Error(i18n.t("stage9.bookings.errors.startRequired"));
  const endsAt = input.endsAt?.trim() ? input.endsAt.trim() : null;
  if (endsAt) {
    const end = new Date(endsAt);
    if (Number.isNaN(end.getTime())) throw new Error(i18n.t("stage9.errors.invalidDate"));
    if (end.getTime() < start.getTime()) throw new Error(i18n.t("stage9.bookings.errors.endBeforeStart"));
  }
  const comment = nullIfBlank(input.comment);
  if ((comment?.length ?? 0) > MAX_BOOKING_COMMENT) throw new Error(i18n.t("stage9.bookings.errors.commentTooLong"));
  return { starts_at: startsAt, ends_at: endsAt, comment, status: "scheduled", source: "manual" };
}

export function createBooking(input: BookingInput, workspaceId: string | undefined) {
  return insertStage9Row("bookings", buildBookingRow(input), workspaceId);
}

/** Soft-deletes a booking (`deleted_at`). */
export function deleteBooking(id: string, workspaceId: string | undefined) {
  return deleteStage9Row("bookings", id, workspaceId);
}
