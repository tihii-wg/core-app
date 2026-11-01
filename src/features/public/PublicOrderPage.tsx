import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { EntityStatusBadge, StatusBadge } from "../../ui/StatusBadge";
import { getPublicOrderStatus, type PublicOrderStatus } from "../../services/apiPublicLinks";

function formatPublicDate(value: string | null, language: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * Read-only public order status page (`/:locale/public/:token`, docs §6 "Публичные страницы").
 * Reachable without signing in, but only a valid `public_links` token returns anything, and only the whitelisted
 * status fields are shown: never the client, prices, notes or comments. No writes, no private data.
 */
export function PublicOrderPage() {
  const { t, i18n } = useTranslation();
  const { token } = useParams();

  // Public status pages must not be indexed.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["public-order-status", token],
    queryFn: () => getPublicOrderStatus(token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.publicOrder.title")}</CardTitle>
          <CardDescription>{t("settings.publicOrder.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? <p className="text-sm text-muted-foreground">{t("settings.publicOrder.loading")}</p> : null}

          {error ? (
            <div className="space-y-3">
              <p className="text-sm text-destructive">{t("settings.publicOrder.error")}</p>
              <Button type="button" variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
                {t("settings.publicOrder.retry")}
              </Button>
            </div>
          ) : null}

          {data?.kind === "notFound" ? (
            <Alert>
              <AlertTitle className="line-clamp-none whitespace-normal">{t("settings.publicOrder.notFound.title")}</AlertTitle>
              <AlertDescription>{t("settings.publicOrder.notFound.body")}</AlertDescription>
            </Alert>
          ) : null}

          {data?.kind === "unavailable" ? (
            <Alert>
              <AlertTitle className="line-clamp-none whitespace-normal">{t("settings.publicOrder.unavailable.title")}</AlertTitle>
              <AlertDescription>{t("settings.publicOrder.unavailable.body")}</AlertDescription>
            </Alert>
          ) : null}

          {data?.kind === "ok" ? <PublicOrderDetails order={data.order} language={i18n.language} /> : null}
        </CardContent>
      </Card>
    </main>
  );
}

type PublicOrderLabelKey = "status" | "number" | "serviceType" | "created" | "deadline" | "updated";

const publicOrderLabelI18n: Record<PublicOrderLabelKey, `settings.publicOrder.labels.${PublicOrderLabelKey}`> = {
  status: "settings.publicOrder.labels.status",
  number: "settings.publicOrder.labels.number",
  serviceType: "settings.publicOrder.labels.serviceType",
  created: "settings.publicOrder.labels.created",
  deadline: "settings.publicOrder.labels.deadline",
  updated: "settings.publicOrder.labels.updated",
};

function PublicOrderDetails({ order, language }: { order: PublicOrderStatus; language: string }) {
  const { t } = useTranslation();
  const rows: { key: PublicOrderLabelKey; value: string | null }[] = [
    { key: "number", value: order.number },
    { key: "serviceType", value: order.serviceType },
    { key: "created", value: formatPublicDate(order.createdAt, language) },
    { key: "deadline", value: formatPublicDate(order.deadline, language) },
    { key: "updated", value: formatPublicDate(order.updatedAt, language) },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{t(publicOrderLabelI18n.status)}</p>
        {order.statusName ? (
          <EntityStatusBadge name={order.statusName} color={order.statusColor} />
        ) : order.status ? (
          <StatusBadge variant="default" dot>
            {t(`status.order.${order.status}`, { defaultValue: order.status })}
          </StatusBadge>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </div>
      <dl className="divide-y divide-border rounded-lg border border-border">
        {rows.map(({ key, value }) =>
          value ? (
            <div key={key} className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm">
              <dt className="text-muted-foreground">{t(publicOrderLabelI18n[key])}</dt>
              <dd className="min-w-0 text-right font-medium text-foreground [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ) : null,
        )}
      </dl>
      <p className="text-xs text-muted-foreground">{t("settings.publicOrder.privacy")}</p>
    </div>
  );
}
