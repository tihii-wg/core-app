import { useForm } from "react-hook-form";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import type { Client, ClientFormValues } from "../../lib/types";
import { useUpdateClient } from "./useUpdateClient";
import ClientFormFields from "./ClientFormFields";

type EditClientFormProps = {
  client: Client;
  onCancel: () => void;
  onUpdated: (client: Client) => void;
};

export default function EditClientForm({ client, onCancel, onUpdated }: EditClientFormProps) {
  const { mutateAsync: updateClient } = useUpdateClient();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ClientFormValues>({
    defaultValues: {
      clientType: client.client_type === "organization" ? "organization" : "individual",
      clientName: client.name,
      taxId: client.tax_id ?? "",
      contactPerson: client.contact_person ?? "",
      email: client.email ?? "",
      phone: client.phone ?? "",
      address: client.address ?? "",
      notes: client.notes ?? "",
    },
  });

  const onSubmit = async (data: ClientFormValues) => {
    try {
      const updatedClient = await updateClient({
        clientId: client.id,
        ...data,
      });
      onUpdated(updatedClient);
    } catch {
      return;
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <ClientFormFields idPrefix="edit-client" control={control} register={register} errors={errors} disabled={isSubmitting} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner className="h-4 w-4" /> : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
