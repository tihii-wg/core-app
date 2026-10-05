import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import type { ClientFormValues, CreateMadalProps } from "../../lib/types";
import { useCreateNewClient } from "./useCreateNewClient";
import ClientFormFields from "./ClientFormFields";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

const emptyClient: ClientFormValues = {
  clientType: "individual",
  clientName: "",
  taxId: "",
  contactPerson: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
};

export default function AddNewClientForm({ setCreateModalOpen }: CreateMadalProps) {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const { mutateAsync: createClient } = useCreateNewClient();

  const {
    register,
    control,
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ClientFormValues>({ defaultValues: emptyClient });

  const onSubmit = async (data: ClientFormValues) => {
    try {
      await createClient({
        ...data,
        workspace_id: workspaceId ?? "",
      });
    } catch {
      return;
    }
    reset(emptyClient);
    setCreateModalOpen(false);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="py-4">
        <ClientFormFields idPrefix="client" control={control} register={register} errors={errors} disabled={isSubmitting} />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setCreateModalOpen(false)} disabled={isSubmitting}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner className="h-4 w-4" /> : t("clients.addClient")}
        </Button>
      </div>
    </form>
  );
}
