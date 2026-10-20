import { CompanySettings } from "./CompanySettings";
import { RegionalSettings } from "./RegionalSettings";
import { GeneralSettingsExtra } from "./GeneralSettingsExtra";

/** Workspace-level General Settings (company, regional, orders, contacts, invoices, legal entities). */
export function GeneralSettings() {
  return (
    <div className="space-y-5">
      <CompanySettings />
      <RegionalSettings />
      <GeneralSettingsExtra />
    </div>
  );
}
