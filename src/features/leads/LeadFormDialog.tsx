import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import type { LeadInput } from "../../services/apiLeads";
import { useCreateLead } from "./useLeadMutations";

type LeadFormDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

export function LeadFormDialog({ open, onOpenChange }: LeadFormDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("stage9.leads.form.title")}</DialogTitle>
          <DialogDescription>{t("stage9.leads.form.description")}</DialogDescription>
        </DialogHeader>
        {open ? <LeadForm onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

const emptyLead: LeadInput = { contactName: "", phone: "", leadType: "inquiry", isUrgent: false };

function LeadForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { mutate: create, isPending } = useCreateLead();
  const [form, setForm] = useState<LeadInput>(emptyLead);
  const canSubmit = form.contactName.trim() !== "" || form.phone.trim() !== "";

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isPending || !canSubmit) return;
    create(form, { onSuccess: onDone });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="lead-name">{t("stage9.leads.form.contactName")}</Label>
          <Input
            id="lead-name"
            maxLength={200}
            value={form.contactName}
            disabled={isPending}
            onChange={(event) => setForm({ ...form, contactName: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lead-phone">{t("stage9.leads.form.phone")}</Label>
          <Input
            id="lead-phone"
            type="tel"
            maxLength={40}
            value={form.phone}
            disabled={isPending}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">{t("stage9.leads.form.contactHint")}</p>
        </div>
        <div className="space-y-1.5">
          <Label>{t("stage9.leads.form.leadType")}</Label>
          <Select
            value={form.leadType}
            disabled={isPending}
            onValueChange={(value) => setForm({ ...form, leadType: value === "missed_call" ? "missed_call" : "inquiry" })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inquiry">{t("stage9.leads.types.inquiry")}</SelectItem>
              <SelectItem value="missed_call">{t("stage9.leads.types.missed_call")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={form.isUrgent}
            disabled={isPending}
            onChange={(event) => setForm({ ...form, isUrgent: event.target.checked })}
          />
          {t("stage9.leads.form.isUrgent")}
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={isPending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isPending || !canSubmit}>
          {isPending ? <Spinner className="size-4" /> : null}
          {t("stage9.leads.form.submit")}
        </Button>
      </div>
    </form>
  );
}
