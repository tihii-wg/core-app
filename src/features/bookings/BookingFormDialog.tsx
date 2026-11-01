import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Spinner } from "../../ui/Spinner";
import { Textarea } from "../../ui/Textarea";
import { fromDatetimeLocalValue } from "../stage9/datetimeLocal";
import { useCreateBooking } from "./useBookingMutations";

type BookingFormDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

export function BookingFormDialog({ open, onOpenChange }: BookingFormDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("stage9.bookings.form.title")}</DialogTitle>
          <DialogDescription>{t("stage9.bookings.form.description")}</DialogDescription>
        </DialogHeader>
        {open ? <BookingForm onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function BookingForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { mutate: create, isPending } = useCreateBooking();
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [comment, setComment] = useState("");
  const startIso = fromDatetimeLocalValue(startsAt);
  const endIso = fromDatetimeLocalValue(endsAt);
  const endBeforeStart = Boolean(startIso && endIso && new Date(endIso).getTime() < new Date(startIso).getTime());

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isPending || !startIso || endBeforeStart) return;
    create({ startsAt: startIso, endsAt: endIso, comment }, { onSuccess: onDone });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="booking-start">{t("stage9.bookings.form.startsAt")}</Label>
          <Input
            id="booking-start"
            type="datetime-local"
            value={startsAt}
            required
            disabled={isPending}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="booking-end">{t("stage9.bookings.endsAt")}</Label>
          <Input
            id="booking-end"
            type="datetime-local"
            value={endsAt}
            min={startsAt || undefined}
            disabled={isPending}
            aria-invalid={endBeforeStart}
            onChange={(event) => setEndsAt(event.target.value)}
          />
          {endBeforeStart ? <p className="text-xs text-destructive">{t("stage9.bookings.errors.endBeforeStart")}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="booking-comment">{t("stage9.bookings.form.comment")}</Label>
          <Textarea
            id="booking-comment"
            rows={3}
            maxLength={1000}
            value={comment}
            disabled={isPending}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={isPending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isPending || !startIso || endBeforeStart}>
          {isPending ? <Spinner className="size-4" /> : null}
          {t("stage9.bookings.form.submit")}
        </Button>
      </div>
    </form>
  );
}
