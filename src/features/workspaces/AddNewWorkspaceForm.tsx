import { useParams } from "react-router-dom";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Spinner } from "../../ui/Spinner";
import { Button } from "../../ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import type { CreateMadalProps } from "../../lib/types";
import { useGetIndustries } from "../industries/useGetIndustries";
import { industryName } from "../industries/industryName";
import { useCreateWorkspace } from "./useCreateWorkspace";

export type AddNewWorkspaceFormData = {
  workspaceName: string;
  role: string;
  industryId: string;
};

export default function AddNewWorkspaceForm({ setCreateModalOpen }: CreateMadalProps) {
  const { t } = useTranslation();
  const { locale } = useParams();
  const { mutateAsync } = useCreateWorkspace();
  const { industries, isLoading: industriesLoading, error: industriesError } = useGetIndustries();
  const {
    register,
    reset,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AddNewWorkspaceFormData>({
    defaultValues: {
      industryId: "",
    },
  });

  const onSubmit = async (data: AddNewWorkspaceFormData) => {
    const newWorkspaceData = {
      name: data.workspaceName,
      role: data.role,
      industryId: data.industryId,
      language: locale,
    };
    try {
      await mutateAsync(newWorkspaceData);
    } catch {
      return;
    }
    reset();
    setCreateModalOpen(false);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="workspaceName">{t("workspaces.create.nameLabel")}</Label>
          <Input
            id="workspaceName"
            type="text"
            {...register("workspaceName", { required: true })}
            autoFocus={true}
            placeholder={t("workspaces.create.namePlaceholder")}
            className={errors.workspaceName ? "focus:border-destructive border-destructive focus:ring-0 " : "hover:border-primary focus:ring-primary"}
            disabled={isSubmitting}
          />
          {errors.workspaceName && <p className="text-xs text-destructive">{t("workspaces.create.nameRequired")}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="industryId">{t("workspaces.create.businessTypeLabel")}</Label>
          <Controller
            name="industryId"
            control={control}
            rules={{ required: t("workspaces.create.businessTypeRequired") }}
            render={({ field }) => (
              <Select value={field.value || undefined} onValueChange={field.onChange} disabled={isSubmitting || industriesLoading}>
                <SelectTrigger id="industryId" className={errors.industryId ? "w-full border-destructive" : "w-full"}>
                  <SelectValue placeholder={t("workspaces.create.businessTypePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {industries.map((industry) => (
                    <SelectItem key={industry.id} value={industry.id}>
                      {industryName(industry)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.industryId && <p className="text-xs text-destructive">{errors.industryId.message}</p>}
          {industriesError && <p className="text-xs text-destructive">{industriesError.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="role">{t("workspaces.create.roleLabel")}</Label>
          <Input id="role" type="text" {...register("role", { required: true })} placeholder={t("workspaces.create.rolePlaceholder")} />
          {errors.role && <p className="text-xs text-destructive">{t("workspaces.create.roleRequired")}</p>}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            reset();
            setCreateModalOpen(false);
          }}
          disabled={isSubmitting}
        >
          {t("common.cancel")}
        </Button>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner className="h-4 w-4" /> : t("workspaces.create.submit")}
        </Button>
      </div>
    </form>
  );
}
