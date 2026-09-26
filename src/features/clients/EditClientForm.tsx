import { useForm } from "react-hook-form";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Spinner } from "../../ui/Spinner";
import { Textarea } from "../../ui/Textarea";
import type { Client, EditClientFormData } from "../../lib/types";
import { useUpdateClient } from "./useUpdateClient";

type EditClientFormProps = {
  client: Client;
  onCancel: () => void;
  onUpdated: (client: Client) => void;
};

export default function EditClientForm({ client, onCancel, onUpdated }: EditClientFormProps) {
  const { mutateAsync: updateClient } = useUpdateClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditClientFormData>({
    defaultValues: {
      clientName: client.name,
      email: client.email ?? "",
      phone: client.phone ?? "",
      address: client.address ?? "",
      notes: client.notes ?? "",
    },
  });

  const onSubmit = async (data: EditClientFormData) => {
    const updatedClient = await updateClient({
      clientId: client.id,
      ...data,
    });

    onUpdated({ ...client, ...updatedClient });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="edit-client-name">Name *</Label>
        <Input
          id="edit-client-name"
          {...register("clientName", { required: "Name is required" })}
          className={errors.clientName ? "border-[#f41f20]" : ""}
          disabled={isSubmitting}
        />
        {errors.clientName && <p className="text-xs text-[#f41f20]">{errors.clientName.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="edit-client-email">Email *</Label>
          <Input
            id="edit-client-email"
            type="email"
            {...register("email", { required: "Email is required" })}
            className={errors.email ? "border-[#f41f20]" : ""}
            disabled={isSubmitting}
          />
          {errors.email && <p className="text-xs text-[#f41f20]">{errors.email.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-client-phone">Phone *</Label>
          <Input
            id="edit-client-phone"
            {...register("phone", {
              required: "Phone is required",
              pattern: {
                value: /^\+373\d{8}$/,
                message: "Phone must be in format +37300000000",
              },
            })}
            placeholder="+37300000000"
            className={errors.phone ? "border-[#f41f20]" : ""}
            disabled={isSubmitting}
          />
          {errors.phone && <p className="text-xs text-[#f41f20]">{errors.phone.message}</p>}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-client-address">Address</Label>
        <Input id="edit-client-address" {...register("address")} disabled={isSubmitting} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-client-notes">Notes</Label>
        <Textarea id="edit-client-notes" {...register("notes")} rows={3} disabled={isSubmitting} />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
          {isSubmitting ? <Spinner className="h-4 w-4" /> : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
