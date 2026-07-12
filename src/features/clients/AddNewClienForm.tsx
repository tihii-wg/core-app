import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Spinner } from "../../ui/Spinner";
import { Button } from "../../ui/Button";
import { Textarea } from "../../ui/Textarea";
import { useForm } from "react-hook-form";
import type { AddNewClientFormData, CreateMadalProps } from "../../lib/types";
import { useCreateNewClient } from "./useCreateNewClient";
import { useParams } from "react-router-dom";

export default function AddNewClientForm({ setCreateModalOpen }: CreateMadalProps) {
  const params = useParams();
  const { mutateAsync: createClient } = useCreateNewClient();
  const {
    register,
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AddNewClientFormData>();

  const onSubmit = (data: AddNewClientFormData) => {
    const newClientData = {
      ...data,
      workspace_id: params?.workspaceId,
      
    };
    createClient(newClientData);
    reset();

    setCreateModalOpen(false);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="clientName">Name *</Label>
          <Input
            id="clientName"
            type="text"
            {...register("clientName", { required: true })}
            autoFocus={true}
            placeholder="Client name"
            className={errors.clientName ? "focus:border-[#f41f20] border-[#f41f20] focus:ring-0 " : "hover:border-[#1973e1] focus:ring-[#1973e1]"}
            disabled={isSubmitting}
          />
          {errors.clientName && <p className="text-xs text-[#f41f20]">Name is required</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="text"
              {...register("email", { required: true })}
              placeholder="email@example.com"
              className={errors.email ? "focus:border-[#f41f20] border-[#f41f20] focus:ring-0 " : "hover:border-[#1973e1] focus:ring-[#1973e1]"}
              disabled={isSubmitting}
            />
            {errors.email && <p className="text-xs text-[#f41f20]">Email is required</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone *</Label>
            <Input
              id="phone"
              type="text"
              {...register("phone", {
                required: true,
                pattern: /^\+[1-9]\d{7,14}$/,
              })}
              placeholder="+1 (555) 000-0000"
              className={errors.email ? "focus:border-[#f41f20] border-[#f41f20] focus:ring-0 " : "hover:border-[#1973e1] focus:ring-[#1973e1]"}
            />
            {errors.phone && <p className="text-xs text-[#f41f20]">Phone is required</p>}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="address">Address</Label>
          <Input id="address" type="text" {...register("address")} placeholder="Street address, city, state" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" {...register("notes")} placeholder="Additional notes about this client..." rows={3} />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          //   onClick={() =>
          //   setCreateModalOpen(false)
          // }
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting} className="bg-[#1973e1] hover:bg-[#1565c0] text-white ">
          {isSubmitting ? <Spinner className="h-4 w-4" /> : "Add Client"}
        </Button>
      </div>
    </form>
  );
}
