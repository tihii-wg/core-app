import { useState, type FormEvent, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../ui/Tabs";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Skeleton } from "../../ui/Skeleton";
import { StatusBadge } from "../../ui/StatusBadge";
import {
  useCreateClientAddress,
  useCreateClientPhone,
  useDeleteClientAddress,
  useDeleteClientPhone,
  useGetClientAddresses,
  useDeleteClientDiscount,
  useGetClientBalanceEntries,
  useGetClientDiscounts,
  useGetClientPhones,
  useUpsertClientDiscount,
} from "./useGetClientExtensions";
import {
  CLIENT_DISCOUNT_TARGETS,
  findClientDiscount,
  parseDiscountPercent,
  type ClientDiscount,
  type ClientDiscountTarget,
} from "./clientDiscounts";

type ExtrasTab = "phones" | "addresses" | "balance" | "discounts";

type ClientExtrasSectionProps = {
  clientId: string;
};

/**
 * Client card extensions (docs §5.3): phones, addresses (add/delete), balance ledger rows (read-only),
 * and per-target discounts (`client_discounts`, written with contacts.edit_discounts).
 * Data comes from crm_ro_v1 tables and degrades to a notice when they are missing.
 * Nothing is fetched until a tab is opened.
 */
export function ClientExtrasSection({ clientId }: ClientExtrasSectionProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ExtrasTab | "">("");

  return (
    <div>
      <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">{t("clients.extras.title")}</h3>
      <Tabs value={tab} onValueChange={(value) => setTab(value as ExtrasTab)}>
        <TabsList className="w-full">
          <TabsTrigger value="phones">
            {t("clients.extras.phones")}
          </TabsTrigger>
          <TabsTrigger value="addresses">
            {t("clients.extras.addresses")}
          </TabsTrigger>
          <TabsTrigger value="balance">
            {t("clients.extras.balance")}
          </TabsTrigger>
          <TabsTrigger value="discounts">
            {t("clients.extras.discounts.tab")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="phones">
          <PhonesTab clientId={clientId} />
        </TabsContent>
        <TabsContent value="addresses">
          <AddressesTab clientId={clientId} />
        </TabsContent>
        <TabsContent value="balance">
          <BalanceTab clientId={clientId} />
        </TabsContent>
        <TabsContent value="discounts">
          <DiscountsTab clientId={clientId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TabState({
  isLoading,
  isError,
  available,
  isEmpty,
  emptyLabel,
  form,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  available: boolean;
  isEmpty: boolean;
  emptyLabel: string;
  /** Rendered above the list/empty state only when the table is available. */
  form?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (isError || !available) {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-5 text-center">
        <p className="text-[13px] font-medium text-foreground">{t("clients.extras.unavailable")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("clients.extras.unavailableHint")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {form}
      {isEmpty ? (
        <div className="rounded-md border border-dashed border-border px-4 py-5 text-center text-[13px] text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function PhonesTab({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const { rows, available, isLoading, isError } = useGetClientPhones(clientId);
  const deletePhone = useDeleteClientPhone(clientId);

  return (
    <TabState
      isLoading={isLoading}
      isError={isError}
      available={available}
      isEmpty={rows.length === 0}
      emptyLabel={t("clients.extras.noPhones")}
      form={<AddPhoneForm clientId={clientId} />}
    >
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <a href={`tel:${row.phone}`} className="text-sm font-medium text-foreground tabular-nums hover:underline">
                {row.phone}
              </a>
              {row.label ? <p className="truncate text-xs text-muted-foreground">{row.label}</p> : null}
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              {row.isPrimary ? <StatusBadge variant="info">{t("clients.extras.primary")}</StatusBadge> : null}
              {row.hasWhatsapp ? <StatusBadge variant="success">{t("clients.extras.whatsapp")}</StatusBadge> : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("clients.extras.deletePhone", { phone: row.phone })}
                disabled={deletePhone.isPending}
                onClick={() => deletePhone.mutate(row.id)}
              >
                <Trash2 />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </TabState>
  );
}

function AddressesTab({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const { rows, available, isLoading, isError } = useGetClientAddresses(clientId);
  const deleteAddress = useDeleteClientAddress(clientId);

  return (
    <TabState
      isLoading={isLoading}
      isError={isError}
      available={available}
      isEmpty={rows.length === 0}
      emptyLabel={t("clients.extras.noAddresses")}
      form={<AddAddressForm clientId={clientId} />}
    >
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm text-foreground [overflow-wrap:anywhere]">{row.address}</p>
              {row.label ? <p className="truncate text-xs text-muted-foreground">{row.label}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {row.isDefault ? <StatusBadge variant="info">{t("clients.extras.default")}</StatusBadge> : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("clients.extras.deleteAddress", { address: row.address })}
                disabled={deleteAddress.isPending}
                onClick={() => deleteAddress.mutate(row.id)}
              >
                <Trash2 />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </TabState>
  );
}

function BalanceTab({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const { rows, available, isLoading, isError } = useGetClientBalanceEntries(clientId);

  return (
    <TabState
      isLoading={isLoading}
      isError={isError}
      available={available}
      isEmpty={rows.length === 0}
      emptyLabel={t("clients.extras.noBalanceEntries")}
      form={<p className="text-xs text-muted-foreground">{t("clients.extras.balanceNote")}</p>}
    >
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">
                {row.description ?? row.documentType ?? t("clients.extras.balanceEntry")}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">{row.createdAt.split("T")[0]}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={`text-sm font-medium tabular-nums ${row.amount < 0 ? "text-destructive" : "text-foreground"}`}>
                {row.amount.toFixed(2)} {row.currencyCode}
              </span>
              {row.isAdjustment ? <StatusBadge variant="muted">{t("clients.extras.adjustment")}</StatusBadge> : null}
            </div>
          </li>
        ))}
      </ul>
    </TabState>
  );
}

function DiscountsTab({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const { rows, available, isLoading, isError } = useGetClientDiscounts(clientId);

  return (
    <TabState
      isLoading={isLoading}
      isError={isError}
      available={available}
      isEmpty={false}
      emptyLabel=""
      form={<p className="text-xs text-muted-foreground">{t("clients.extras.discounts.note")}</p>}
    >
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {CLIENT_DISCOUNT_TARGETS.map((target) => {
          const discount = findClientDiscount(rows, target);
          return (
            <DiscountRow key={`${target}:${discount?.updatedAt ?? ""}:${discount?.percent ?? ""}`} clientId={clientId} target={target} discount={discount} />
          );
        })}
      </ul>
    </TabState>
  );
}

function DiscountRow({ clientId, target, discount }: { clientId: string; target: ClientDiscountTarget; discount: ClientDiscount | null }) {
  const { t } = useTranslation();
  const upsert = useUpsertClientDiscount(clientId);
  const remove = useDeleteClientDiscount(clientId);
  const isPriceType = discount?.mode === "price_type";
  const [value, setValue] = useState(discount?.percent != null ? String(discount.percent) : "");
  const parsed = parseDiscountPercent(value);
  const invalid = Number.isNaN(parsed);
  const unchanged = !isPriceType && (parsed ?? null) === (discount?.percent ?? null);
  const label = t(`clients.extras.discounts.targets.${target}`);
  const busy = upsert.isPending || remove.isPending;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (invalid || busy) return;
    if (parsed === null) {
      if (discount) remove.mutate(target);
      return;
    }
    upsert.mutate({ target, percent: value });
  }

  return (
    <li>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5" aria-label={label}>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{label}</p>
          {isPriceType ? <p className="text-xs text-muted-foreground">{t("clients.extras.discounts.priceTypeNote")}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="relative">
            <Input
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="0"
              aria-label={t("clients.extras.discounts.percentLabel", { target: label })}
              aria-invalid={invalid || undefined}
              disabled={busy}
              className="w-24 pr-7 text-right tabular-nums"
            />
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground">
              %
            </span>
          </div>
          <Button type="submit" size="sm" loading={busy} disabled={invalid || unchanged || (parsed === null && !discount)}>
            {parsed === null && discount ? t("clients.extras.discounts.clear") : t("common.save")}
          </Button>
        </div>
        {invalid ? <p className="w-full text-xs text-destructive">{t("clients.extras.discounts.errors.invalidPercent")}</p> : null}
      </form>
    </li>
  );
}

const checkboxClassName = "size-4 rounded border-border-strong accent-primary";

function AddPhoneForm({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const createPhone = useCreateClientPhone(clientId);
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [allowSms, setAllowSms] = useState(true);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!phone.trim()) return;
    createPhone.mutate(
      { phone, label, isPrimary, allowSms },
      {
        onSuccess: () => {
          setPhone("");
          setLabel("");
          setIsPrimary(false);
          setAllowSms(true);
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-lg border border-border p-3" aria-label={t("clients.extras.addPhone")}>
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder={t("clients.extras.phonePlaceholder")}
          aria-label={t("clients.extras.phoneLabel")}
        />
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={t("clients.extras.labelPlaceholder")}
          aria-label={t("clients.extras.labelLabel")}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className={checkboxClassName} checked={isPrimary} onChange={(event) => setIsPrimary(event.target.checked)} />
            {t("clients.extras.markPrimary")}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className={checkboxClassName} checked={allowSms} onChange={(event) => setAllowSms(event.target.checked)} />
            {t("clients.extras.allowSms")}
          </label>
        </div>
        <Button type="submit" size="sm" loading={createPhone.isPending} disabled={!phone.trim()}>
          {t("clients.extras.add")}
        </Button>
      </div>
    </form>
  );
}

function AddAddressForm({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const createAddress = useCreateClientAddress(clientId);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!address.trim()) return;
    createAddress.mutate(
      { address, label, isDefault },
      {
        onSuccess: () => {
          setAddress("");
          setLabel("");
          setIsDefault(false);
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-lg border border-border p-3" aria-label={t("clients.extras.addAddress")}>
      <div className="grid grid-cols-2 gap-2">
        <Input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder={t("clients.extras.addressPlaceholder")}
          aria-label={t("clients.extras.addressLabel")}
        />
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={t("clients.extras.labelPlaceholder")}
          aria-label={t("clients.extras.labelLabel")}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" className={checkboxClassName} checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />
          {t("clients.extras.markDefault")}
        </label>
        <Button type="submit" size="sm" loading={createAddress.isPending} disabled={!address.trim()}>
          {t("clients.extras.add")}
        </Button>
      </div>
    </form>
  );
}
