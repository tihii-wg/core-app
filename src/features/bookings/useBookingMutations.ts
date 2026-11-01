import i18n from "../../i18n";
import { createBooking, deleteBooking, type BookingInput } from "../../services/apiBookings";
import { useStage9Mutation } from "../stage9/useStage9Mutation";

export function useCreateBooking() {
  return useStage9Mutation<BookingInput>("bookings", (input, ws) => createBooking(input, ws), () => i18n.t("stage9.bookings.toast.created"));
}

export function useDeleteBooking() {
  return useStage9Mutation<string>("bookings", (id, ws) => deleteBooking(id, ws), () => i18n.t("stage9.bookings.toast.deleted"));
}
