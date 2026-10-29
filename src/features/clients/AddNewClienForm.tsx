import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Button } from "../../ui/Button";
import { Label } from "../../ui/Label";
import { Spinner } from "../../ui/Spinner";
import { Switch } from "../../ui/Switch";
import type { ClientFormValues, CreateMadalProps } from "../../lib/types";
import { createVehicle } from "../../services/apiVehicles";
import { useCreateNewClient } from "./useCreateNewClient";
import ClientFormFields from "./ClientFormFields";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { industrySupportsClientVehicles } from "../industries/industryCapabilities";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { VehicleFields } from "../vehicles/VehicleFields";
import { clientVehiclesQueryKey } from "../vehicles/useGetClientVehicles";
import { emptyVehicleFormValues, vehicleFormValuesToInput, type VehicleFormValues } from "../vehicles/vehicleForm";

export default function AddNewClientForm({ setCreateModalOpen }: CreateMadalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const { workflow } = useIndustryWorkflow();
  const showVehicleOption = industrySupportsClientVehicles(workflow);
  const { mutateAsync: createClient } = useCreateNewClient();
  const guardWrite = useGuardSubscriptionWrite();
  const [addVehicle, setAddVehicle] = useState(false);
  const [vehicleSaving, setVehicleSaving] = useState(false);

  const emptyClient: ClientFormValues = {
    clientType: "individual",
    clientName: "",
    middleName: "",
    taxId: "",
    contactPerson: "",
    email: "",
    phone: "",
    address: "",
    notes: "",
    phoneNotificationsConsent: Boolean(workspace?.defaultPhoneConsent),
    emailNotificationsConsent: Boolean(workspace?.defaultEmailConsent),
  };

  const {
    register,
    control,
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ClientFormValues>({ defaultValues: emptyClient });

  const {
    register: registerVehicle,
    setValue: setVehicleValue,
    watch: watchVehicle,
    reset: resetVehicle,
    trigger: triggerVehicle,
    getValues: getVehicleValues,
    formState: { errors: vehicleErrors },
  } = useForm<VehicleFormValues>({ defaultValues: emptyVehicleFormValues() });

  useEffect(() => {
    if (!addVehicle) resetVehicle(emptyVehicleFormValues());
  }, [addVehicle, resetVehicle]);

  const busy = isSubmitting || vehicleSaving;

  const onSubmit = async (data: ClientFormValues) => {
    if (showVehicleOption && addVehicle) {
      const vehicleOk = await triggerVehicle();
      if (!vehicleOk) return;

      let vehicleInput;
      try {
        vehicleInput = vehicleFormValuesToInput(getVehicleValues());
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
        return;
      }

      let createdClients;
      try {
        createdClients = await createClient({
          ...data,
          workspace_id: workspaceId ?? "",
        });
      } catch {
        return;
      }

      const createdClient = createdClients?.[0];
      if (!createdClient?.id) {
        toast.error(t("clients.toast.createFailed"));
        return;
      }

      setVehicleSaving(true);
      try {
        guardWrite();
        await createVehicle(workspaceId, createdClient.id, vehicleInput);
        void queryClient.invalidateQueries({ queryKey: clientVehiclesQueryKey(workspaceId, createdClient.id) });
        toast.success(t("vehicles.toast.created"), { id: "create-client-vehicle" });
      } catch (error) {
        const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
        toast.error(`${t("clients.toast.createdButVehicleFailed")}${detail}`, { id: "create-client-vehicle" });
      } finally {
        setVehicleSaving(false);
      }

      reset(emptyClient);
      resetVehicle(emptyVehicleFormValues());
      setAddVehicle(false);
      setCreateModalOpen(false);
      return;
    }

    try {
      await createClient({
        ...data,
        workspace_id: workspaceId ?? "",
      });
    } catch {
      return;
    }

    reset(emptyClient);
    resetVehicle(emptyVehicleFormValues());
    setAddVehicle(false);
    setCreateModalOpen(false);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-4 py-4">
        <ClientFormFields idPrefix="client" control={control} register={register} errors={errors} disabled={busy} />

        {showVehicleOption ? (
          <div className="space-y-3 rounded-lg border border-border px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor="client-add-vehicle" className="text-sm font-medium">
                  {t("clients.form.addVehicleToggle")}
                </Label>
                <p className="text-xs text-muted-foreground">{t("clients.form.addVehicleHint")}</p>
              </div>
              <Switch
                id="client-add-vehicle"
                checked={addVehicle}
                onCheckedChange={setAddVehicle}
                disabled={busy}
              />
            </div>
            {addVehicle ? (
              <VehicleFields
                idPrefix="new-client-vehicle"
                register={registerVehicle}
                setValue={setVehicleValue}
                watch={watchVehicle}
                errors={vehicleErrors}
                disabled={busy}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setCreateModalOpen(false)} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : t("clients.addClient")}
        </Button>
      </div>
    </form>
  );
}
