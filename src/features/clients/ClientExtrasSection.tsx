import { useState, type FormEvent, type ReactNode } from "react";
import { Trash2, Undo2 } from "lucide-react";
import { useConfirm } from "../../ui/ConfirmProvider";
import { BALANCE_CANCEL_DOCUMENT_TYPE } from "../../services/apiClientExtensions";
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
  useCancelClientBalanceEntry,
  useAddClientBalanceEntry,
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
  /** Called with the new advance after a balance entry is cancelled (the card shows it). */
  onBalanceChanged?: (balance: number) => void;
};

/**
 * Client card extensions (docs §5.3): phones, addresses (add/delete), balance ledger rows (read-only),
 * and per-target discounts (`client_discounts`, written with contacts.edit_discounts).
 * Data comes from crm_ro_v1 tables and degrades to a notice when they are missing.
 * Nothing is fetched until a tab is opened.
 */
export function ClientExtrasSection({ clientId, onBalanceChanged }: ClientExtrasSectionProps) {
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
          <BalanceTab clientId={clientId} onBalanceChanged={onBalanceChanged} />
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

function BalanceTab({ clientId, onBalanceChanged }: { clientId: string; onBalanceChanged?: (balance: number) => void }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { rows, available, isLoading, isError } = useGetClientBalanceEntries(clientId);
  const cancelEntry = useCancelClientBalanceEntry(clientId, onBalanceChanged);
  // Entries already cancelled (a reversal row points at them).
  const cancelledIds = new Set(
    rows.filter((row) => row.documentType === BALANCE_CANCEL_DOCUMENT_TYPE && row.documentId).map((row) => row.documentId as string),
  );

  async function handleCancel(row: (typeof rows)[number]) {
    const ok = await confirm({
      title: t("clients.extras.balanceCancel.confirmTitle"),
      description: t("clients.extras.balanceCancel.confirmBody", {
        amount: `${row.amount.toFixed(2)} ${row.currencyCode}`,
        description: row.description ?? t("clients.extras.balanceEntry"),
      }),
      confirmLabel: t("clients.extras.balanceCancel.confirm"),
      cancelLabel: t("common.cancel"),
    });
    if (ok) cancelEntry.mutate(row.id);
  }

  return (
    <TabState
      isLoading={isLoading}
      isError={isError}
      available={available}
      isEmpty={rows.length === 0}
      emptyLabel={t("clients.extras.noBalanceEntries")}
      form={
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t("clients.extras.balanceNote")}</p>
          <AddBalanceEntryForm clientId={clientId} onBalanceChanged={onBalanceChanged} />
        </div>
      }
    >
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {rows.map((row) => {
          const isReversal = row.documentType === BALANCE_CANCEL_DOCUMENT_TYPE;
          const isCancelled = cancelledIds.has(row.id);
          return (
            <li key={row.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className={`truncate text-sm ${isCancelled ? "text-muted-foreground line-through" : "text-foreground"}`}>
                  {row.description ??
                    (row.documentType === "advance"
                      ? t("clients.extras.balanceAdd.kinds.advance")
                      : row.documentType === "write_off"
                        ? t("clients.extras.balanceAdd.kinds.writeOff")
                        : isReversal
                          ? null
                          : row.documentType) ??
                    t("clients.extras.balanceEntry")}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">{row.createdAt.split("T")[0]}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span
                  className={`text-sm font-medium tabular-nums ${
                    isCancelled ? "text-muted-foreground line-through" : row.amount < 0 ? "text-destructive" : "text-foreground"
                  }`}
                >
                  {row.amount.toFixed(2)} {row.currencyCode}
                </span>
                {isCancelled ? (
                  <StatusBadge variant="muted">{t("clients.extras.balanceCancel.cancelled")}</StatusBadge>
                ) : isReversal ? (
                  <StatusBadge variant="warning">{t("clients.extras.balanceCancel.reversal")}</StatusBadge>
                ) : (
                  <>
                    {row.isAdjustment ? <StatusBadge variant="muted">{t("clients.extras.adjustment")}</StatusBadge> : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={cancelEntry.isPending}
                      onClick={() => void handleCancel(row)}
                    >
                      <Undo2 />
                      {t("clients.extras.balanceCancel.action")}
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
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

/** Advance received from the client (+) or a write-off (−); goes to the client's balance (advance). */
function AddBalanceEntryForm({ clientId, onBalanceChanged }: { clientId: string; onBalanceChanged?: (balance: number) => void }) {
  const { t } = useTranslation();
  const addEntry = useAddClientBalanceEntry(clientId, onBalanceChanged);
  const [kind, setKind] = useState<"advance" | "writeOff">("advance");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const parsed = Number(amount.replace(",", "."));
  const valid = Number.isFinite(parsed) && parsed > 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    addEntry.mutate(
      { amount: kind === "advance" ? parsed : -parsed, description },
      {
        onSuccess: () => {
          setAmount("");
          setDescription("");
          setKind("advance");
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-lg border border-border p-3" aria-label={t("clients.extras.balanceAdd.title")}>
      <p className="text-sm font-medium text-foreground">{t("clients.extras.balanceAdd.title")}</p>
      <div className="flex flex-wrap gap-3 text-xs text-foreground">
        {(["advance", "writeOff"] as const).map((value) => (
          <label key={value} className="flex items-center gap-1.5">
            <input type="radio" name={`balance-kind-${clientId}`} checked={kind === value} onChange={() => setKind(value)} />
            {t(`clients.extras.balanceAdd.kinds.${value}`)}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-2">
        <Input
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder={t("clients.extras.balanceAdd.amountPlaceholder")}
          aria-label={t("clients.extras.balanceAdd.amount")}
        />
        <Input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t("clients.extras.balanceAdd.commentPlaceholder")}
          aria-label={t("clients.extras.balanceAdd.comment")}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={addEntry.isPending} disabled={!valid}>
          {t("clients.extras.balanceAdd.submit")}
        </Button>
      </div>
    </form>
  );
}

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
