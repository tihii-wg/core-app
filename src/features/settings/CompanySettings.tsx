import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Building2, Save } from "lucide-react";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Skeleton } from "../../ui/Skeleton";
import { Separator } from "../../ui/Separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { useGetIndustries } from "../industries/useGetIndustries";
import { industryName } from "../industries/industryName";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useUpdateWorkspace } from "../workspaces/useUpdateWorkspace";
import { parseMarkupPercent, markupFieldError } from "../inventory/markup";
import type { WorkspaceDetails } from "../../services/apiWorkspaces";
import { CompanyLogoControls } from "./CompanyLogoControls";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { canManageWorkspace } from "../workspaces/workspaceRoles";

type CompanyFormValues = {
  name: string;
  industryId: string;
  inventoryMarkup: string;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

function CompanyForm({ workspace }: { workspace: WorkspaceDetails }) {
  const { t } = useTranslation();
  const { industries, isLoading: industriesLoading, error: industriesError } = useGetIndustries();
  const { mutateAsync: saveWorkspace, isPending: isSavingWorkspace } = useUpdateWorkspace();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<CompanyFormValues>({
    defaultValues: {
      name: workspace.name,
      industryId: workspace.industryId ?? "",
      inventoryMarkup: workspace.inventoryMarkup == null ? "0" : String(workspace.inventoryMarkup),
    },
  });

  const saving = isSavingWorkspace || isSubmitting;
  const canEdit = canManageWorkspace(workspace.role);
  const locked = saving || !canEdit;

  async function onSubmit(values: CompanyFormValues) {
    const markupMessage = markupFieldError(values.inventoryMarkup);
    if (markupMessage) {
      setError("inventoryMarkup", { message: markupMessage });
      return;
    }

    const inventoryMarkup = parseMarkupPercent(values.inventoryMarkup);
    if (inventoryMarkup == null) return;

    try {
      await saveWorkspace({ workspaceId: workspace.id, name: values.name, industryId: values.industryId, inventoryMarkup });
    } catch {
      return;
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.company.title")}</CardTitle>
        <CardDescription>{t("settings.company.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <CompanyLogoControls workspace={workspace} />

        <Separator />

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="companyName">{t("settings.company.nameLabel")}</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="companyName"
                  {...register("name", {
                    required: t("settings.company.validation.nameRequired"),
                    validate: (value) => value.trim().length > 0 || t("settings.company.validation.nameRequired"),
                  })}
                  disabled={locked}
                  className={errors.name ? "border-destructive pl-10" : "pl-10"}
                />
              </div>
              <FieldError message={errors.name?.message} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="businessType">{t("settings.company.businessTypeLabel")}</Label>
              <Controller
                name="industryId"
                control={control}
                rules={{ required: t("settings.company.validation.businessTypeRequired") }}
                render={({ field }) => (
                  <Select value={field.value || undefined} onValueChange={field.onChange} disabled={locked || industriesLoading}>
                    <SelectTrigger id="businessType" className={errors.industryId ? "w-full border-destructive" : "w-full"}>
                      <SelectValue placeholder={industriesLoading ? t("settings.company.businessTypeLoading") : t("settings.company.businessTypeLabel")} />
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
              <FieldError message={errors.industryId?.message} />
              {industriesError && <p className="text-xs text-destructive">{industriesError.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="inventoryMarkup">{t("settings.company.markupLabel")}</Label>
              <Input
                id="inventoryMarkup"
                type="number"
                min={0}
                max={1000}
                step="0.01"
                disabled={locked}
                {...register("inventoryMarkup", {
                  required: t("settings.company.validation.markupRequired"),
                  validate: (value) => markupFieldError(value) ?? true,
                })}
                className={errors.inventoryMarkup ? "border-destructive" : ""}
              />
              <FieldError message={errors.inventoryMarkup?.message} />
              <p className="text-xs text-muted-foreground">{t("settings.company.markupHint")}</p>
            </div>
          </div>

          {canEdit ? (
            <div className="flex justify-end">
              <Button type="submit" disabled={saving || !isDirty}>
                <Save />
                {saving ? t("common.saving") : t("common.saveChanges")}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("settings.company.ownerOnly")}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export function CompanySettings() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace, isLoading, error, refetch, isFetched } = useGetWorkspace(workspaceId);

  if (!workspaceId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.company.title")}</CardTitle>
          <CardDescription>{t("settings.company.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("settings.company.chooseCompany")}</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.company.title")}</CardTitle>
          <CardDescription>{t("settings.company.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-20 rounded-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    const message = error instanceof Error ? error.message : t("settings.company.loadFailed");
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.company.title")}</CardTitle>
          <CardDescription>{t("settings.company.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-destructive">{message}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void refetch();
            }}
          >
            {t("common.retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isFetched && !workspace) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.company.title")}</CardTitle>
          <CardDescription>{t("settings.company.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("settings.company.notMember")}</p>
        </CardContent>
      </Card>
    );
  }

  if (!workspace) return null;

  return <CompanyForm key={`${workspace.id}:${workspace.name}:${workspace.industryId ?? ""}:${workspace.inventoryMarkup ?? ""}`} workspace={workspace} />;
}
