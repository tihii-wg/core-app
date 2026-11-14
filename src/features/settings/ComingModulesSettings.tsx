import { CalendarClock, ClipboardList, Link2, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { Badge } from "../../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";

/** Stage 9 (P2) modules from docs/ro-app-migration.md. Each links to a read-only list page (no writes yet). */
const comingModules = [
  { key: "leads", icon: ClipboardList, table: "leads", docSection: "5.13", route: "leads" },
  { key: "bookings", icon: CalendarClock, table: "bookings", docSection: "5.13", route: "bookings" },
] as const satisfies readonly { key: string; icon: LucideIcon; table: string; docSection: string; route: string }[];

export function ComingModulesSettings() {
  const { t } = useTranslation();
  const { locale = "en", workspaceId } = useParams();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.modules.title")}</CardTitle>
        <CardDescription>{t("settings.modules.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="grid gap-3 sm:grid-cols-2">
          {comingModules.map(({ key, icon: Icon, table, docSection, route }) => (
            <li key={key} className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-subtle-foreground">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{t(`settings.modules.items.${key}.title`)}</p>
                  <Badge variant="secondary">{t("settings.modules.planned")}</Badge>
                </div>
                <p className="text-[13px] text-muted-foreground">{t(`settings.modules.items.${key}.description`)}</p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.modules.reference", { table, section: docSection })}
                </p>
                {workspaceId ? (
                  <Link
                    to={`/${locale}/${workspaceId}/${route}`}
                    className="inline-block text-xs font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {t("settings.modules.open")}
                  </Link>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("settings.modules.empty")}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-subtle-foreground">
            <Link2 aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground">{t("settings.modules.publicLinks.title")}</p>
              <Badge variant="secondary">{t("settings.modules.planned")}</Badge>
            </div>
            <p className="text-[13px] text-muted-foreground">{t("settings.modules.publicLinks.description")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.modules.publicLinks.reference")}</p>
            <p className="text-xs text-muted-foreground">
              <code>{t("settings.modules.publicLinks.route", { locale })}</code>
            </p>
            <p className="text-xs text-muted-foreground">{t("settings.modules.publicLinks.note")}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("settings.modules.note")}</p>
      </CardContent>
    </Card>
  );
}
