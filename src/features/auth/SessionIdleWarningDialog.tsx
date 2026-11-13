import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/Dialog";

type Props = {
  open: boolean;
  secondsRemaining: number;
  onContinue: () => void;
  onSignOut: () => void;
};

export function SessionIdleWarningDialog({ open, secondsRemaining, onContinue, onSignOut }: Props) {
  const { t } = useTranslation();
  const seconds = Math.max(0, secondsRemaining);

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        className="max-w-[min(100vw-1.5rem,24rem)] sm:max-w-md"
        showCloseButton={false}
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("auth.idleTimeout.warningTitle")}</DialogTitle>
          <DialogDescription>
            {t("auth.idleTimeout.warningBody", { count: seconds })}
          </DialogDescription>
        </DialogHeader>
        <p className="text-center text-3xl font-semibold tabular-nums tracking-tight text-foreground" aria-live="polite">
          {seconds}
          <span className="ml-1 text-base font-normal text-muted-foreground">{t("auth.idleTimeout.secondsUnit")}</span>
        </p>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onSignOut}>
            {t("auth.idleTimeout.signOut")}
          </Button>
          <Button type="button" className="w-full sm:w-auto" onClick={onContinue}>
            {t("auth.idleTimeout.continue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
