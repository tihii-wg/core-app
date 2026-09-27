import { useState } from "react";
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
      setDisableError(caught instanceof Error ? caught.message : "Unable to disable two-factor authentication. Please try again.");
    } finally {
      setConfirming(false);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>Protect your account with an authenticator app.</CardDescription>
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
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>Protect your account with an authenticator app.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-[#f41f20]">{error instanceof Error ? error.message : "Unable to load two-factor authentication. Please try again."}</p>
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const needsRecentCode = data.currentLevel !== "aal2";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor authentication</CardTitle>
        <CardDescription>Protect your account with an authenticator app.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div>
            <p className="text-sm text-muted-foreground">Status</p>
            <StatusBadge variant={data.enabled ? "success" : "muted"}>{data.enabled ? "Enabled" : "Not enabled"}</StatusBadge>
          </div>
          {data.enabled ? (
            <Button type="button" variant="outline" onClick={() => setDisableOpen(true)}>
              Disable 2FA
            </Button>
          ) : (
            <Button type="button" disabled={enroll.isPending} onClick={() => void startEnrollment().catch(() => undefined)}>
              {enroll.isPending ? "Enabling 2FA..." : "Enable 2FA"}
            </Button>
          )}
        </div>
        {enroll.error && <p className="text-sm text-[#f41f20]">{enroll.error.message}</p>}
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
            <DialogTitle>Disable two-factor authentication?</DialogTitle>
            <DialogDescription>Your account will no longer require a verification code from your authenticator app.</DialogDescription>
          </DialogHeader>
          {needsRecentCode && (
            <div className="space-y-2">
              <Label htmlFor="disable-mfa-code">Enter the 6-digit code from your authenticator app to continue.</Label>
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
          {disableError && <p className="text-sm text-[#f41f20]">{disableError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={confirming} onClick={() => setDisableOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={confirming || (needsRecentCode && disableCode.length !== 6)} onClick={() => void confirmDisable()}>
              {confirming ? "Disabling 2FA..." : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
