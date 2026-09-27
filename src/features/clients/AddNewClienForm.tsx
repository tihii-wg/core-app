import { useForm } from "react-hook-form";
import { useParams } from "react-router-dom";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import type { ClientFormValues, CreateMadalProps } from "../../lib/types";
import { useCreateNewClient } from "./useCreateNewClient";
import ClientFormFields from "./ClientFormFields";

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
  const params = useParams();
  const { mutateAsync: createClient } = useCreateNewClient();

  const {
    register,
    control,
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ClientFormValues>({ defaultValues: emptyClient });

  const onSubmit = async (data: ClientFormValues) => {
    if (!params.workspaceId) throw new Error("No active workspace selected");

    await createClient({
      ...data,
      workspace_id: params.workspaceId,
    });
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
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
          {isSubmitting ? <Spinner className="h-4 w-4" /> : "Add Client"}
        </Button>
      </div>
    </form>
  );
}
