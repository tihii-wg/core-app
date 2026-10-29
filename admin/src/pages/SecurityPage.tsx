import { DataSourceBanner } from "@/components/DataSourceBanner";
import { Badge, Card, PageHeader } from "@/components/ui";
import { backendFindings, recommendedBackendDesign } from "@/data/backendFindings";
import { adminCapabilities, backendPrerequisites } from "@/data/capabilities";
import { useT } from "@/i18n/I18nProvider";

function findingTone(status: (typeof backendFindings)[number]["status"]) {
  if (status === "present") return "success" as const;
  if (status === "partial" || status === "frontend-only") return "warning" as const;
  return "danger" as const;
}

export function SecurityPage() {
  const t = useT();

  return (
    <div className="space-y-6">
      <PageHeader title={t("security.title")} description={t("security.description")} />
      <DataSourceBanner />

      <Card className="overflow-hidden">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--fg)]">{t("security.capabilityTitle")}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--bg)_65%,var(--bg-elevated))] text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">{t("security.capabilityCol")}</th>
                <th className="px-4 py-3 font-medium">{t("security.statusCol")}</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  "listAllWorkspaces",
                  "aggregateCounts",
                  "platformOwnerAuthz",
                  "changePlan",
                  "changeExpiration",
                  "suspendWorkspace",
                  "reactivateWorkspace",
                  "auditLog",
                ] as const
              ).map((key) => (
                <tr key={key} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-3">{t(`security.caps.${key}`)}</td>
                  <td className="px-4 py-3">
                    {adminCapabilities[key] ? (
                      <Badge tone="success">{t("security.available")}</Badge>
                    ) : (
                      <Badge tone="danger">{t("security.blocked")}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--fg)]">{t("security.findingsTitle")}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{t("security.findingsHint")}</p>
        </div>
        <ul className="divide-y divide-[var(--border)]">
          {backendFindings.map((finding) => (
            <li key={finding.id} className="space-y-2 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-[var(--fg)]">
                  {t(`findings.${finding.id}.area`)}: {t(`findings.${finding.id}.summary`)}
                </p>
                <Badge tone={findingTone(finding.status)}>{t(`security.findingStatus.${finding.status}`)}</Badge>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--muted)]">
                {finding.evidence.map((item) => (
                  <li key={item}>
                    <code className="break-all">{item}</code>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--fg)]">{t("security.prerequisitesTitle")}</h2>
        {backendPrerequisites.map((item) => (
          <Card key={item.id} className="p-4">
            <p className="text-sm font-medium text-[var(--fg)]">{t(`prerequisites.${item.id}.title`)}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">{t(`prerequisites.${item.id}.detail`)}</p>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--fg)]">{t("security.recommendedTitle")}</h2>
        {recommendedBackendDesign.map((item) => (
          <Card key={item.id} className="p-4">
            <p className="text-sm font-medium text-[var(--fg)]">{t(`recommended.${item.id}.title`)}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">{t(`recommended.${item.id}.detail`)}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
