import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Label } from "../../ui/Label";
import { useConfirm } from "../../ui/ConfirmProvider";
import type { GoogleCalendarEvent } from "../../services/apiGoogleCalendar";
import type { UpsertGoogleCalendarEventInput } from "../../services/apiGoogleCalendar";

export type CalendarEventDraft = {
  mode: "create" | "edit";
  event?: GoogleCalendarEvent | null;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
};

type Props = {
  open: boolean;
  draft: CalendarEventDraft | null;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: UpsertGoogleCalendarEventInput & { etag?: string }) => void;
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

export function CalendarEventDialog({ open, draft, busy, onOpenChange, onSave, onDelete }: Props) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");

  useEffect(() => {
    if (!draft || !open) return;
    setTitle(draft.title);
    setDescription(draft.description);
    setLocation(draft.location);
    setAllDay(draft.allDay);
    setStartLocal(toLocalInputValue(draft.start, draft.allDay));
    setEndLocal(toLocalInputValue(draft.end, draft.allDay));
  }, [draft, open]);

  if (!draft) return null;

  const isRecurring = Boolean(draft.event?.recurringEventId);
  const isEdit = draft.mode === "edit";

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
    if (!draft || !title.trim() || !startLocal || !endLocal) return;
    onSave({
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      start: fromLocalInputValue(startLocal, allDay),
      end: fromLocalInputValue(endLocal, allDay),
      allDay,
      ...(draft.mode === "edit" && draft.event?.etag ? { etag: draft.event.etag } : {}),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("calendar.event.editTitle") : t("calendar.event.newTitle")}</DialogTitle>
          {isRecurring ? <DialogDescription>{t("calendar.event.recurringHint")}</DialogDescription> : null}
        </DialogHeader>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="gcal-title">{t("calendar.event.title")}</Label>
            <input
              id="gcal-title"
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("calendar.event.titlePlaceholder")}
              required
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            {t("calendar.event.allDay")}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="gcal-start">{t("calendar.event.start")}</Label>
              <input
                id="gcal-start"
                type={allDay ? "date" : "datetime-local"}
                className="border-input bg-background flex h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gcal-end">{t("calendar.event.end")}</Label>
              <input
                id="gcal-end"
                type={allDay ? "date" : "datetime-local"}
                className="border-input bg-background flex h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gcal-location">{t("calendar.event.location")}</Label>
            <input
              id="gcal-location"
              className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gcal-desc">{t("calendar.event.description")}</Label>
            <textarea
              id="gcal-desc"
              className="border-input bg-background flex min-h-[72px] w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {draft.event?.authorUserName ? (
            <p className="text-muted-foreground text-xs">{t("calendar.event.author", { name: draft.event.authorUserName })}</p>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {isEdit && draft.event?.htmlLink ? (
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
            <Button type="submit" size="sm" disabled={busy || !title.trim()}>
              {isEdit ? t("calendar.event.save") : t("calendar.event.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
