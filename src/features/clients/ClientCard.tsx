import { EllipsisVertical, Eye, Mail, Pencil, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Client } from "../../lib/types";
import { Button } from "../../ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/DropdownMenu";
import ClientTypeBadge from "./ClientTypeBadge";

type ClientCardProps = {
  client: Client;
  ordersCount: number;
  formatMoney: (value: number) => string;
  onView: (client: Client) => void;
  onEdit: (client: Client) => void;
};

/**
 * Compact phone layout for one client (below the md breakpoint). The whole
 * surface opens the client detail panel; the actions menu is independent.
 */
export function ClientCard({ client, ordersCount, formatMoney, onView, onEdit }: ClientCardProps) {
  const { t } = useTranslation();
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

  return (
    <article
      onClick={() => onView(client)}
      className="cursor-pointer rounded-lg border border-border bg-card p-3 shadow-xs transition-colors hover:bg-accent/40 active:bg-accent/60"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground" title={client.name}>
            {client.name}
          </p>
          <div className="mt-1">
            <ClientTypeBadge clientType={client.client_type} />
          </div>
        </div>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-10 shrink-0"
              aria-label={t("clients.actions.menuLabel", { name: client.name })}
              onClick={stop}
            >
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52" onClick={stop}>
            <DropdownMenuItem onSelect={() => onView(client)}>
              <Eye />
              {t("clients.actions.viewDetails")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onEdit(client)}>
              <Pencil />
              {t("common.edit")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {(client.phone || client.email) && (
        <div className="mt-1.5 space-y-0.5 text-[13px]">
          {client.phone ? (
            <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <Phone aria-hidden="true" className="size-3 shrink-0 text-subtle-foreground" />
              <span className="truncate tabular-nums">{client.phone}</span>
            </p>
          ) : null}
          {client.email ? (
            <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <Mail aria-hidden="true" className="size-3 shrink-0 text-subtle-foreground" />
              <span className="truncate" title={client.email}>
                {client.email}
              </span>
            </p>
          ) : null}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2.5 text-sm">
        <span className="text-muted-foreground">
          {t("clients.table.orders")}: <span className="font-medium text-foreground tabular-nums">{ordersCount}</span>
        </span>
        <span className="ml-auto text-right">
          <span className="block text-[11px] text-muted-foreground">{t("clients.table.balance")}</span>
          <span className={client.balance > 0 ? "font-semibold text-destructive tabular-nums" : "font-semibold text-foreground tabular-nums"}>
            {formatMoney(client.balance)}
          </span>
        </span>
      </div>
    </article>
  );
}
