import { ChangePasswordForm } from "./ChangePasswordForm";
import { TwoFactorSettings } from "./TwoFactorSettings";

export function SecuritySettings() {
  return (
    <div className="space-y-6">
      <ChangePasswordForm />
      <TwoFactorSettings />
    </div>
  );
}
