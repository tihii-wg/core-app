import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { adminCapabilities } from "@/data/capabilities";
import { useT } from "@/i18n/I18nProvider";
import { useLayoutPreview } from "@/state/LayoutPreviewContext";
import { Button, Card } from "./ui";

export function DataSourceBanner() {
  const t = useT();
  const { isPlatformOwner, platformOwnerReason } = useAuth();
  const { showDemoLayoutPreview, setShowDemoLayoutPreview } = useLayoutPreview();
  const liveData = adminCapabilities.listAllWorkspaces && isPlatformOwner;

  return (
    <div className="space-y-3">
      <Card className="border-[color-mix(in_oklab,var(--warning)_45%,var(--border))] bg-[color-mix(in_oklab,var(--warning)_10%,var(--bg-elevated))] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--warning)]" aria-hidden />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold text-[var(--fg)]">
                {liveData ? t("dataBanner.liveTitle") : t("dataBanner.unavailableTitle")}
              </p>
              <p className="text-sm text-[var(--muted)]">
                {liveData ? t("dataBanner.liveBody") : t("liveData.unavailableReason")}
              </p>
              {!liveData ? (
                <p className="text-sm font-medium text-[var(--fg)]">{t("dataBanner.demoNotReal")}</p>
              ) : null}
            </div>
          </div>
          {!liveData ? (
            <Button
              type="button"
              variant="secondary"
              className="shrink-0"
              aria-pressed={showDemoLayoutPreview}
              onClick={() => setShowDemoLayoutPreview(!showDemoLayoutPreview)}
            >
              {showDemoLayoutPreview ? t("dataBanner.hidePreview") : t("dataBanner.showPreview")}
            </Button>
          ) : null}
        </div>
      </Card>

      {showDemoLayoutPreview && !liveData ? (
        <Card className="border-[color-mix(in_oklab,var(--warning)_45%,var(--border))] p-4">
          <div className="flex gap-3">
            <Info className="mt-0.5 size-5 shrink-0 text-[var(--warning)]" aria-hidden />
            <p className="text-sm text-[var(--muted)]">
              <span className="font-semibold text-[var(--fg)]">{t("dataBanner.previewActiveTitle")}</span>{" "}
              {t("dataBanner.previewActiveBody")}
            </p>
          </div>
        </Card>
      ) : null}

      <Card className="border-[color-mix(in_oklab,var(--danger)_35%,var(--border))] bg-[color-mix(in_oklab,var(--danger)_8%,var(--bg-elevated))] p-4">
        <div className="flex gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-[var(--danger)]" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-[var(--fg)]">{t("dataBanner.authzTitle")}</p>
            <p className="text-sm text-[var(--muted)]">{platformOwnerReason}</p>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex gap-3">
          <Info className="mt-0.5 size-5 shrink-0 text-[var(--primary)]" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-[var(--fg)]">{t("dataBanner.mutationsTitle")}</p>
            <p className="text-sm text-[var(--muted)]">{t("dataBanner.mutationsBody")}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
