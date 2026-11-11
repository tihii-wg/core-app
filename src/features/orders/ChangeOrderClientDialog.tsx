import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { MissingRpcError } from "../../services/missingRpc";
import type { Client, Order, Vehicle } from "../../lib/types";
import { useDebounce } from "../../hooks/useDebounce";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Label } from "../../ui/Label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { Spinner } from "../../ui/Spinner";
import { AddClientDialog } from "../clients/AddClientDialog";
import ClientCombobox from "../clients/ClientCombobox";
import { useGetClientDiscounts } from "../clients/useGetClientExtensions";
import { useGetClients } from "../clients/useGetClients";
import { industrySupportsClientVehicles } from "../industries/industryCapabilities";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { vehicleDisplayLabel } from "../../services/apiVehicles";
import { useGetClientVehicles } from "../vehicles/useGetClientVehicles";
import { useSearchVehiclesByRegistration } from "../vehicles/useSearchVehiclesByRegistration";
import { fieldConfigMap, useOrderFieldConfig } from "./useOrderFieldConfig";
import { OrderVehicleFields } from "./OrderVehicleFields";
import { useChangeOrderClient } from "./useChangeOrderClient";

type FormValues = {
  clientId: string;
  vehicleId: string;
  device: string;
  carNumber: string;
  vin: string;
  currentMileage: string;
};

type ChangeOrderClientDialogProps = {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasInvoice: boolean;
  /** Portal target inside the order sheet so Esc / focus stay nested. */
  portalContainer?: HTMLElement | null;
  onChanged?: (order: Order) => void;
};

function stopBubble(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function clientLabel(order: Order) {
  return order.clientName?.trim() || "—";
}

function vehicleLabelFromOrder(order: Order, vehicles: Vehicle[]) {
  const id = order.vehicleId?.trim() || "";
  if (!id) return "—";
  const hit = vehicles.find((v) => v.id === id);
  if (hit) return vehicleDisplayLabel(hit);
  if (order.device?.trim() || order.carNumber?.trim()) {
    return [order.device?.trim(), order.carNumber?.trim()].filter(Boolean).join(" · ") || "—";
  }
  return "—";
}

export default function ChangeOrderClientDialog({
  order,
  open,
  onOpenChange,
  hasInvoice,
  portalContainer,
  onChanged,
}: ChangeOrderClientDialogProps) {
  const { t } = useTranslation();
  const isDesktop = useMediaQuery("(min-width: 640px)");
  const { workflow } = useIndustryWorkflow();
  const showVehicles = industrySupportsClientVehicles(workflow);
  const changeClient = useChangeOrderClient();
  const { fields: orderFieldConfig } = useOrderFieldConfig();
  const orderFieldMap = useMemo(() => fieldConfigMap(orderFieldConfig), [orderFieldConfig]);

  const [clientName, setClientName] = useState("");
  const [extraClients, setExtraClients] = useState<Client[]>([]);
  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [clientDialogInitialName, setClientDialogInitialName] = useState("");
  const [confirmInvoice, setConfirmInvoice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientInputRef = useRef<HTMLInputElement | null>(null);

  const form = useForm<FormValues>({
    defaultValues: {
      clientId: "",
      vehicleId: "",
      device: "",
      carNumber: "",
      vin: "",
      currentMileage: "",
    },
  });
  const { control, setValue, register, formState, reset, getValues } = form;
  const selectedClientId = useWatch({ control, name: "clientId" }) || "";
  const selectedVehicleId = useWatch({ control, name: "vehicleId" }) || "";

  const debouncedClientSearch = useDebounce(clientName.trim(), 250);
  const { clients } = useGetClients(debouncedClientSearch, "all", { includeVehicleMatches: !showVehicles });
  const vehicleFieldSearchEnabled = showVehicles && debouncedClientSearch.length >= 2;
  const {
    hits: vehicleRegistrationHits,
    isLoading: vehicleRegistrationLoading,
    isError: vehicleRegistrationError,
  } = useSearchVehiclesByRegistration(debouncedClientSearch, { enabled: open && vehicleFieldSearchEnabled });
  const { vehicles: selectedClientVehicles } = useGetClientVehicles(selectedClientId || null);
  const { rows: newClientDiscounts } = useGetClientDiscounts(selectedClientId || null, open && Boolean(selectedClientId));
  const hasNewClientDiscounts = (newClientDiscounts?.length ?? 0) > 0;

  const clientsForCombobox = useMemo(() => {
    const base = clients ?? [];
    const extras = extraClients.filter((extra) => !base.some((client) => client.id === extra.id));
    return extras.length > 0 ? [...extras, ...base] : base;
  }, [clients, extraClients]);

  const selectedClient = clientsForCombobox.find((c) => c.id === selectedClientId) ?? null;

  useEffect(() => {
    if (!open || !order) return;
    const name = order.clientName?.trim() || "";
    setClientName(name);
    setExtraClients([]);
    setConfirmInvoice(false);
    setError(null);
    reset({
      clientId: order.clientId?.trim() || "",
      vehicleId: order.vehicleId?.trim() || "",
      device: order.device ?? "",
      carNumber: order.carNumber ?? "",
      vin: order.vin ?? "",
      currentMileage: "",
    });
  }, [open, order, reset]);

  const initialClientId = order?.clientId?.trim() || "";
  const initialVehicleId = order?.vehicleId?.trim() || "";
  const clientChanged = selectedClientId !== initialClientId;
  const vehicleChanged = showVehicles && (selectedVehicleId || "") !== initialVehicleId;
  const dirty = clientChanged || vehicleChanged;
  const invoiceOk = !hasInvoice || confirmInvoice;
  const canSave = dirty && Boolean(selectedClientId) && invoiceOk && !changeClient.isPending;

  const wasLine = order
    ? showVehicles
      ? t("orders.changeClient.summaryPair", {
          client: clientLabel(order),
          vehicle: vehicleLabelFromOrder(order, selectedClientVehicles),
        })
      : clientLabel(order)
    : "—";

  const willClientName = selectedClient?.name?.trim() || clientName.trim() || "—";
  const willVehicle =
    showVehicles && selectedVehicleId
      ? (() => {
          const hit = selectedClientVehicles.find((v) => v.id === selectedVehicleId);
          return hit ? vehicleDisplayLabel(hit) : selectedVehicleId;
        })()
      : "—";
  const willLine = showVehicles
    ? t("orders.changeClient.summaryPair", { client: willClientName, vehicle: willVehicle })
    : willClientName;

  const pending = changeClient.isPending;

  const guardedOpenChange = (next: boolean) => {
    if (!next && pending) return;
    onOpenChange(next);
  };

  async function handleSave() {
    if (!order || !canSave) return;
    setError(null);
    try {
      const values = getValues();
      const updated = await changeClient.mutateAsync({
        orderId: order.id,
        previousClientId: order.clientId,
        patch: {
          clientId: values.clientId,
          vehicleId: showVehicles ? values.vehicleId?.trim() || null : order.vehicleId ?? null,
          confirmInvoice: hasInvoice ? confirmInvoice : undefined,
        },
      });
      onChanged?.(updated);
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof MissingRpcError
          ? err.message
          : err instanceof Error
            ? err.message
            : t("common.somethingWentWrong");
      setError(message);
    }
  }

  const body = (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-1" data-testid="change-order-client-body">
      <section className="space-y-1.5" data-testid="change-order-client-step-client">
        <Label htmlFor="change-order-client-search">{t("orders.changeClient.clientSection")}</Label>
        <Controller
          name="clientId"
          control={control}
          render={({ field }) => (
            <ClientCombobox
              inputRef={(node) => {
                clientInputRef.current = node;
                if (typeof field.ref === "function") field.ref(node);
                else if (field.ref) (field.ref as { current: HTMLInputElement | null }).current = node;
              }}
              clients={clientsForCombobox}
              value={clientName}
              placeholder={showVehicles ? t("clients.combobox.placeholderWithPlate") : undefined}
              vehicleHits={showVehicles ? vehicleRegistrationHits : undefined}
              vehicleHitsLoading={showVehicles && vehicleFieldSearchEnabled ? vehicleRegistrationLoading : false}
              vehicleHitsError={showVehicles && vehicleFieldSearchEnabled ? vehicleRegistrationError : false}
              onChange={(value) => {
                setClientName(value);
                field.onChange("");
                setValue("vehicleId", "");
              }}
              onSelect={(client) => {
                setClientName(client.name);
                field.onChange(client.id);
                setValue("vehicleId", "");
              }}
              onSelectVehicle={
                showVehicles
                  ? (hit) => {
                      setExtraClients((current) =>
                        current.some((client) => client.id === hit.client.id) ? current : [hit.client, ...current],
                      );
                      setClientName(hit.client.name);
                      field.onChange(hit.client.id);
                      setValue("vehicleId", hit.vehicleId, { shouldDirty: true });
                    }
                  : undefined
              }
              onCreateRequest={(name) => {
                setClientName(name);
                field.onChange("");
                setValue("vehicleId", "");
                setClientDialogInitialName(name);
                setClientDialogOpen(true);
              }}
            />
          )}
        />
        {selectedClientId ? (
          <p className="text-xs text-muted-foreground">
            {t("clients.combobox.selectedHint", {
              name: selectedClient?.name || clientName,
              phone: selectedClient?.phone?.trim() || t("clients.combobox.noPhone"),
            })}
          </p>
        ) : null}
      </section>

      {showVehicles && selectedClientId ? (
        <section className="space-y-1.5" data-testid="change-order-client-step-vehicle">
          <Label>{t("orders.changeClient.vehicleSection")}</Label>
          <OrderVehicleFields
            control={control}
            setValue={setValue}
            register={register}
            errors={formState.errors}
            clientId={selectedClientId}
            disabled={pending}
            mileageMode="empty"
            fieldConfig={orderFieldMap}
          />
        </section>
      ) : null}

      {hasNewClientDiscounts && clientChanged ? (
        <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="change-order-client-discount-hint">
          {t("orders.changeClient.discountHint")}
        </p>
      ) : null}

      {hasInvoice ? (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3" data-testid="change-order-client-invoice-warning">
          <p className="text-sm text-foreground">{t("orders.changeClient.invoiceWarning")}</p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-primary"
              checked={confirmInvoice}
              onChange={(event) => setConfirmInvoice(event.target.checked)}
              disabled={pending}
              data-testid="change-order-client-invoice-confirm"
            />
            <span>{t("orders.changeClient.invoiceConfirm")}</span>
          </label>
        </div>
      ) : null}

      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]" data-testid="change-order-client-summary">
        {t("orders.changeClient.summary", { was: wasLine, will: willLine })}
      </p>

      {order?.payerClientId &&
      order.clientId &&
      order.payerClientId !== order.clientId &&
      clientChanged ? (
        <p className="text-xs text-muted-foreground" data-testid="change-order-client-payer-note">
          {t("orders.changeClient.payerUnchanged")}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="change-order-client-error">
          {error}
        </p>
      ) : null}
    </div>
  );

  const footer = (
    <div className="flex shrink-0 justify-end gap-2 border-t bg-elevated pt-3">
      <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
        {t("common.cancel")}
      </Button>
      <Button
        type="button"
        onClick={() => void handleSave()}
        disabled={!canSave}
        data-testid="change-order-client-save"
      >
        {pending ? <Spinner className="h-4 w-4" /> : t("common.save")}
      </Button>
    </div>
  );

  const title = t("orders.changeClient.changeTitle");
  const description = t("orders.changeClient.changeDescription");

  return (
    <>
      {isDesktop ? (
        <Dialog open={open && Boolean(order)} onOpenChange={guardedOpenChange}>
          <DialogContent
            container={portalContainer}
            className="flex h-[min(640px,90vh)] max-h-[90vh] flex-col sm:max-w-lg"
            onClick={stopBubble}
            onPointerDown={stopBubble}
            onEscapeKeyDown={(event) => {
              // Keep the order sheet open; only dismiss this dialog.
              event.stopPropagation();
            }}
          >
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            {body}
            {footer}
          </DialogContent>
        </Dialog>
      ) : (
        <Sheet open={open && Boolean(order)} onOpenChange={guardedOpenChange}>
          <SheetContent
            side="bottom"
            className="h-dvh max-h-dvh w-full gap-0 sm:max-w-none"
            onClick={stopBubble}
            onPointerDown={stopBubble}
            onEscapeKeyDown={(event) => {
              event.stopPropagation();
            }}
          >
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>{description}</SheetDescription>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col px-4 pt-3 pb-4">
              {body}
              {footer}
            </div>
          </SheetContent>
        </Sheet>
      )}

      <AddClientDialog
        open={clientDialogOpen}
        onOpenChange={setClientDialogOpen}
        initialName={clientDialogInitialName}
        onCreated={({ client, vehicleId }) => {
          setExtraClients((current) => (current.some((c) => c.id === client.id) ? current : [client, ...current]));
          setClientName(client.name);
          setValue("clientId", client.id, { shouldDirty: true });
          setValue("vehicleId", vehicleId ?? "", { shouldDirty: true });
          setClientDialogOpen(false);
        }}
      />
    </>
  );
}
