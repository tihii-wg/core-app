import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Skeleton } from "../../ui/Skeleton";
import { StatusBadge } from "../../ui/StatusBadge";
import { useDisableMfa, useEnrollMfa, useMfaStatus } from "../auth/useMfa";
import { verifyTotp } from "../../services/apiMfa";
import type { TotpEnrollment } from "../../services/apiMfa";
import { EnableMfaDialog } from "./EnableMfaDialog";

export function TwoFactorSettings() {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useMfaStatus();
  const enroll = useEnrollMfa();
  const disable = useDisableMfa();
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [disableError, setDisableError] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function startEnrollment() {
    const next = await enroll.mutateAsync();
    setEnrollment(next);
    setSetupOpen(true);
  }

  async function confirmDisable() {
    if (!data?.factorId || confirming) return;
    setConfirming(true);
    setDisableError("");
    try {
      if (data.currentLevel !== "aal2") {
        await verifyTotp(data.factorId, disableCode);
      }
      await disable.mutateAsync(data.factorId);
      setDisableOpen(false);
      setDisableCode("");
    } catch (caught) {
      setDisableError(caught instanceof Error ? caught.message : t("settings.security.twoFactor.disableFailed"));
    } finally {
      setConfirming(false);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.security.twoFactor.title")}</CardTitle>
          <CardDescription>{t("settings.security.twoFactor.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.security.twoFactor.title")}</CardTitle>
          <CardDescription>{t("settings.security.twoFactor.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-destructive">{error instanceof Error ? error.message : t("settings.security.twoFactor.loadFailed")}</p>
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            {t("common.retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const needsRecentCode = data.currentLevel !== "aal2";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.security.twoFactor.title")}</CardTitle>
        <CardDescription>{t("settings.security.twoFactor.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div>
            <p className="text-sm text-muted-foreground">{t("common.status")}</p>
            <StatusBadge variant={data.enabled ? "success" : "muted"}>{data.enabled ? t("settings.security.twoFactor.enabled") : t("settings.security.twoFactor.notEnabled")}</StatusBadge>
          </div>
          {data.enabled ? (
            <Button type="button" variant="outline" onClick={() => setDisableOpen(true)}>
              {t("settings.security.twoFactor.disable")}
            </Button>
          ) : (
            <Button type="button" disabled={enroll.isPending} onClick={() => void startEnrollment().catch(() => undefined)}>
              {enroll.isPending ? t("settings.security.twoFactor.enabling") : t("settings.security.twoFactor.enable")}
            </Button>
          )}
        </div>
        {enroll.error && <p className="text-sm text-destructive">{enroll.error.message}</p>}
      </CardContent>

      <EnableMfaDialog
        enrollment={enrollment}
        open={setupOpen}
        onOpenChange={setSetupOpen}
        onVerified={() => {
          setEnrollment(null);
          void refetch();
        }}
      />

      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("settings.security.twoFactor.disableDialog.title")}</DialogTitle>
            <DialogDescription>{t("settings.security.twoFactor.disableDialog.description")}</DialogDescription>
          </DialogHeader>
          {needsRecentCode && (
            <div className="space-y-2">
              <Label htmlFor="disable-mfa-code">{t("settings.security.twoFactor.disableDialog.codeLabel")}</Label>
              <Input
                id="disable-mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={disableCode}
                disabled={confirming}
                onChange={(event) => setDisableCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
          )}
          {disableError && <p className="text-sm text-destructive">{disableError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={confirming} onClick={() => setDisableOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" disabled={confirming || (needsRecentCode && disableCode.length !== 6)} onClick={() => void confirmDisable()}>
              {confirming ? t("settings.security.twoFactor.disabling") : t("common.continue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
