import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Label } from "../../ui/Label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "../../ui/Sheet";
import { useConfirm } from "../../ui/ConfirmProvider";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { GoogleCalendarEvent } from "../../services/apiGoogleCalendar";
import type { UpsertGoogleCalendarEventInput } from "../../services/apiGoogleCalendar";
import { isWritableAccessRole } from "./gcalColors";
import { cn } from "../../lib/utils";

export type CalendarSelectOption = {
  id: string;
  summary: string;
  accessRole: string;
  isMain?: boolean;
};

export type CalendarEventDraft = {
  mode: "create" | "edit" | "view";
  event?: GoogleCalendarEvent | null;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarId?: string | null;
};

type Props = {
  open: boolean;
  draft: CalendarEventDraft | null;
  busy?: boolean;
  calendarOptions: CalendarSelectOption[];
  calendarNameById?: Record<string, string>;
  onOpenChange: (open: boolean) => void;
  onSave: (
    input: UpsertGoogleCalendarEventInput & { etag?: string; calendarId?: string | null },
    meta?: { moveToCalendarId?: string | null },
  ) => void;
  onDelete?: () => void;
};

function toLocalInputValue(isoOrDate: string, allDay: boolean): string {
  if (allDay) return isoOrDate.slice(0, 10);
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(value: string, allDay: boolean): string {
  if (allDay) return value.slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

const inputClass =
  "border-input bg-background flex h-10 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 sm:h-9 sm:text-sm";

export function CalendarEventDialog({
  open,
  draft,
  busy,
  calendarOptions,
  calendarNameById,
  onOpenChange,
  onSave,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const isMobile = useMediaQuery("(max-width: 639px)");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [calendarId, setCalendarId] = useState("");

  const writableOptions = useMemo(
    () => calendarOptions.filter((c) => c.isMain || isWritableAccessRole(c.accessRole)),
    [calendarOptions],
  );

  useEffect(() => {
    if (!draft || !open) return;
    setTitle(draft.title);
    setDescription(draft.description);
    setLocation(draft.location);
    setAllDay(draft.allDay);
    setStartLocal(toLocalInputValue(draft.start, draft.allDay));
    setEndLocal(toLocalInputValue(draft.end, draft.allDay));
    const initial =
      draft.calendarId ||
      draft.event?.calendarId ||
      writableOptions.find((c) => c.isMain)?.id ||
      writableOptions[0]?.id ||
      "";
    setCalendarId(initial);
  }, [draft, open, writableOptions]);

  if (!draft) return null;

  const isRecurring = Boolean(draft.event?.recurringEventId);
  const isEdit = draft.mode === "edit";
  const isView = draft.mode === "view";
  const viewCalendarName =
    (draft.calendarId && calendarNameById?.[draft.calendarId]) ||
    (draft.event?.calendarId && calendarNameById?.[draft.event.calendarId]) ||
    draft.event?.calendarId ||
    "";

  const heading = isView
    ? t("calendar.event.viewTitle")
    : isEdit
      ? t("calendar.event.editTitle")
      : t("calendar.event.newTitle");

  async function handleDelete() {
    if (!onDelete) return;
    const ok = await confirm({
      title: t("calendar.confirmDelete.title"),
      description: t("calendar.confirmDelete.description"),
      confirmLabel: t("calendar.confirmDelete.confirm"),
      tone: "destructive",
      icon: "warning",
    });
    if (!ok) return;
    onDelete();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || isView || !title.trim() || !startLocal || !endLocal) return;
    const originalCal = draft.event?.calendarId?.trim() || draft.calendarId?.trim() || "";
    const nextCal = calendarId.trim();
    const moveTo =
      isEdit && originalCal && nextCal && originalCal !== nextCal ? nextCal : undefined;
    onSave(
      {
        title: title.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        start: fromLocalInputValue(startLocal, allDay),
        end: fromLocalInputValue(endLocal, allDay),
        allDay,
        calendarId: isEdit ? originalCal || nextCal : nextCal || null,
        ...(draft.mode === "edit" && draft.event?.etag ? { etag: draft.event.etag } : {}),
      },
      { moveToCalendarId: moveTo },
    );
  }

  const fields = (
    <>
      {isView ? (
        <div className="space-y-1.5">
          <Label>{t("calendar.event.calendar")}</Label>
          <p className="text-sm">{viewCalendarName || "—"}</p>
        </div>
      ) : writableOptions.length > 0 ? (
        <div className="space-y-1.5">
          <Label htmlFor="gcal-calendar">{t("calendar.event.calendar")}</Label>
          <select
            id="gcal-calendar"
            className={inputClass}
            value={calendarId}
            onChange={(e) => setCalendarId(e.target.value)}
          >
            {writableOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.summary}
                {c.isMain ? ` (${t("calendar.mainBadge")})` : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="gcal-title">{t("calendar.event.title")}</Label>
        <input
          id="gcal-title"
          className={cn(inputClass, "placeholder:text-muted-foreground")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("calendar.event.titlePlaceholder")}
          required
          disabled={isView}
          readOnly={isView}
        />
      </div>
      <label className="flex items-center gap-2 text-base sm:text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
          disabled={isView}
        />
        {t("calendar.event.allDay")}
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="gcal-start">{t("calendar.event.start")}</Label>
          <input
            id="gcal-start"
            type={allDay ? "date" : "datetime-local"}
            className={inputClass}
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
            required
            disabled={isView}
            readOnly={isView}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gcal-end">{t("calendar.event.end")}</Label>
          <input
            id="gcal-end"
            type={allDay ? "date" : "datetime-local"}
            className={inputClass}
            value={endLocal}
            onChange={(e) => setEndLocal(e.target.value)}
            required
            disabled={isView}
            readOnly={isView}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="gcal-location">{t("calendar.event.location")}</Label>
        <input
          id="gcal-location"
          className={inputClass}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          disabled={isView}
          readOnly={isView}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="gcal-desc">{t("calendar.event.description")}</Label>
        <textarea
          id="gcal-desc"
          className={cn(inputClass, "min-h-[88px] py-2")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isView}
          readOnly={isView}
        />
      </div>
      {draft.event?.authorUserName ? (
        <p className="text-muted-foreground text-xs">
          {t("calendar.event.author", { name: draft.event.authorUserName })}
        </p>
      ) : null}
    </>
  );

  const actions = (
    <>
      <div className="flex flex-wrap gap-2">
        {(isEdit || isView) && draft.event?.htmlLink ? (
          <Button type="button" variant="outline" size="sm" asChild>
            <a href={draft.event.htmlLink} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              {t("calendar.event.openInGoogle")}
            </a>
          </Button>
        ) : null}
        {isEdit && onDelete ? (
          <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void handleDelete()}>
            {t("calendar.event.delete")}
          </Button>
        ) : null}
      </div>
      {isView ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
          {t("calendar.event.close")}
        </Button>
      ) : (
        <Button type="submit" size="sm" disabled={busy || !title.trim()}>
          {isEdit ? t("calendar.event.save") : t("calendar.event.create")}
        </Button>
      )}
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="gcal-event-sheet flex h-[100dvh] max-h-[100dvh] w-full flex-col gap-0 rounded-none border-0 p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-none"
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>{heading}</SheetTitle>
            {isRecurring && !isView ? (
              <SheetDescription>{t("calendar.event.recurringHint")}</SheetDescription>
            ) : null}
          </SheetHeader>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-3">{fields}</div>
            <SheetFooter className="bg-elevated sticky bottom-0 shrink-0 flex-row flex-wrap items-center justify-between gap-2 border-t">
              {actions}
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          {isRecurring && !isView ? (
            <DialogDescription>{t("calendar.event.recurringHint")}</DialogDescription>
          ) : null}
        </DialogHeader>
        <form className="space-y-3" onSubmit={handleSubmit}>
          {fields}
          <DialogFooter className="gap-2 sm:justify-between">{actions}</DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
