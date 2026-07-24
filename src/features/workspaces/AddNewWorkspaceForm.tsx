import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Spinner } from "../../ui/Spinner";
import { Button } from "../../ui/Button";
import { useForm } from "react-hook-form";
import { useUser } from "../auth/useUser";
import { useCreateWorkspace } from "./useCreateWorkspace";

export type AddNewWorkspaceFormData = {
  workspaceName: string;
  role: string;
};

export default function AddNewWorkspaceForm({ setCreateModalOpen }) {
  const { user } = useUser();
  const { mutateAsync } = useCreateWorkspace();
  const {
    register,
    reset,
    // watch,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AddNewWorkspaceFormData>();

  const onSubmit = (data: AddNewWorkspaceFormData) => {
    const newWorkspaceData = {
      name: data.workspaceName,
      role: data.role,
      userId: user.id,
    };
    mutateAsync(newWorkspaceData);
    setCreateModalOpen(false);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="workspaceName">Workspace *</Label>
          <Input
            id="workspaceName"
            type="text"
            {...register("workspaceName", { required: true })}
            autoFocus={true}
            placeholder="Workspace"
            className={errors.workspaceName ? "focus:border-[#f41f20] border-[#f41f20] focus:ring-0 " : "hover:border-[#1973e1] focus:ring-[#1973e1]"}
            disabled={isSubmitting}
          />
          {errors.workspaceName && <p className="text-xs text-[#f41f20]">Name is required</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="role">Role *</Label>
          <Input id="role" type="text" {...register("role", { required: true })} placeholder="Role" />
          {errors.role && <p className="text-xs text-[#f41f20]">Role is required</p>}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={
            () => reset()
            // setCreateModalOpen(false)
          }
          disabled={isSubmitting}
        >
          Cancel
        </Button>

        <Button type="submit" disabled={isSubmitting} className="bg-[#1973e1] hover:bg-[#1565c0] text-white ">
          {isSubmitting ? <Spinner className="h-4 w-4" /> : "Add Company"}
        </Button>
      </div>
    </form>
  );
}
