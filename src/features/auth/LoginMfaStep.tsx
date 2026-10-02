import { useState } from "react";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { verifyTotp } from "../../services/apiMfa";
import type { User } from "@supabase/supabase-js";

type LoginMfaStepProps = {
  factorId: string;
  onVerified: (user: User) => void;
  onBack: () => void;
};

export function LoginMfaStep({ factorId, onVerified, onBack }: LoginMfaStepProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (verifying) return;
    setVerifying(true);
    setError("");
    try {
      const user = await verifyTotp(factorId, code);
      onVerified(user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invalid verification code.");
      setVerifying(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-medium text-foreground">Two-factor authentication</h2>
        <p className="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="login-mfa-code">Authentication code</Label>
        <Input
          id="login-mfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          disabled={verifying}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          className="h-10 tracking-[0.4em]"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <Button type="submit" disabled={verifying || code.length !== 6} size="lg" className="w-full">
        {verifying ? "Verifying..." : "Verify"}
      </Button>
      <button type="button" onClick={onBack} disabled={verifying} className="w-full text-sm text-primary hover:underline">
        Back to login
      </button>
    </form>
  );
}
