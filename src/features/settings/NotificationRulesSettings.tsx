import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { useDryRunNotify } from "../notifications/useDryRunNotify";
import { useClientConsentSummary } from "../notifications/useClientConsentSummary";
import { useGetMessageTemplates } from "../notifications/useGetMessageTemplates";
import { useGetNotificationRules } from "../notifications/useGetNotificationRules";

/**
 * Stage 5: list of notification rules (`notification_rules`) with a per-rule "Log dry-run" button.
 * The button only writes a sample `message_log` row; nothing is ever sent to a real provider.
 * Also lists `message_templates` (read-only) and shows the client consent note with counts when available.
 */
export function NotificationRulesSettings() {
  const { t } = useTranslation();
  const { data = [], isLoading, error } = useGetNotificationRules();
  const dryRun = useDryRunNotify();
  const { data: templateData, isLoading: templatesLoading, error: templatesError } = useGetMessageTemplates();
  const { data: consent } = useClientConsentSummary();
  const templates = templateData?.templates ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.notificationRules.title")}</CardTitle>
        <CardDescription>{t("settings.notificationRules.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <p className="text-sm text-muted-foreground">{t("settings.notificationRules.loading")}</p> : null}
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        {!isLoading && !error && data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.notificationRules.empty")}</p>
        ) : null}
        {data.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.map((rule) => (
              <li key={rule.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {rule.entity} · {rule.event}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(`settings.notificationRules.audiences.${rule.audience}`)}
                    {" · "}
                    {t(`settings.notificationRules.channels.${rule.channel}`)}
                    {rule.templateName ? ` · ${rule.templateName}` : ""}
                    {rule.delayMinutes > 0
                      ? ` · ${t("settings.notificationRules.delay", { minutes: rule.delayMinutes })}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="text-xs text-muted-foreground">
                    {rule.isActive ? t("settings.notificationRules.active") : t("settings.notificationRules.inactive")}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={dryRun.isPending && dryRun.variables?.ruleId === rule.id}
                    disabled={dryRun.isPending}
                    onClick={() =>
                      dryRun.mutate({
                        ruleId: rule.id,
                        channel: rule.channel,
                        recipient: t("settings.notificationRules.dryRun.sampleRecipient"),
                        body: t("settings.notificationRules.dryRun.sampleBody", {
                          entity: rule.entity,
                          event: rule.event,
                        }),
                      })
                    }
                  >
                    {t("settings.notificationRules.dryRun.button")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <section className="space-y-2" aria-labelledby="message-templates-title">
          <h3 id="message-templates-title" className="text-sm font-medium text-foreground">
            {t("settings.notificationRules.templates.title")}
          </h3>
          {templatesLoading ? (
            <p className="text-sm text-muted-foreground">{t("settings.notificationRules.templates.loading")}</p>
          ) : null}
          {templatesError ? <p className="text-sm text-destructive">{templatesError.message}</p> : null}
          {templateData?.isUnavailable ? (
            <p className="text-sm text-muted-foreground">{t("settings.notificationRules.templates.unavailable")}</p>
          ) : null}
          {!templatesLoading && !templatesError && templateData && !templateData.isUnavailable && templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("settings.notificationRules.templates.empty")}</p>
          ) : null}
          {templates.length > 0 ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {templates.map((template) => (
                <li key={template.id} className="space-y-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">{template.name}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t(`settings.notificationRules.channels.${template.channel}`)}
                      {template.isActive ? "" : ` · ${t("settings.notificationRules.inactive")}`}
                    </span>
                  </div>
                  {/* Plain text only: React escapes the body, nothing is rendered as HTML. */}
                  <p className="line-clamp-3 text-xs whitespace-pre-wrap text-muted-foreground">{template.body}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{t("settings.notificationRules.consent.title")}</p>
          <p>{t("settings.notificationRules.consent.note")}</p>
          {consent ? (
            <p className="tabular-nums">
              {t("settings.notificationRules.consent.counts", {
                phone: consent.phoneConsent,
                email: consent.emailConsent,
                total: consent.total,
              })}
            </p>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t("settings.notificationRules.stubNote")}</p>
        <p className="text-xs text-muted-foreground">{t("settings.notificationRules.dryRun.productionDisabled")}</p>
      </CardContent>
    </Card>
  );
}
