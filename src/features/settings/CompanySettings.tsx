import { useParams } from "react-router-dom";
import { Controller, useForm } from "react-hook-form";
import { Building2, Save } from "lucide-react";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Skeleton } from "../../ui/Skeleton";
import { Separator } from "../../ui/Separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { useGetIndustries } from "../industries/useGetIndustries";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useUpdateWorkspace } from "../workspaces/useUpdateWorkspace";
import { parseMarkupPercent, markupFieldError } from "../inventory/markup";
import type { WorkspaceDetails } from "../../services/apiWorkspaces";
import { CompanyLogoControls } from "./CompanyLogoControls";

type CompanyFormValues = {
  name: string;
  industryId: string;
  inventoryMarkup: string;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-[#f41f20]">{message}</p>;
}

function CompanyForm({ workspace }: { workspace: WorkspaceDetails }) {
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
        <CardTitle>Company Information</CardTitle>
        <CardDescription>Update your company details and contact information</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <CompanyLogoControls workspace={workspace} />

        <Separator />

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="companyName">Company name</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="companyName"
                  {...register("name", {
                    required: "Company name is required",
                    validate: (value) => value.trim().length > 0 || "Company name is required",
                  })}
                  disabled={saving}
                  className={errors.name ? "border-[#f41f20] pl-10" : "pl-10"}
                />
              </div>
              <FieldError message={errors.name?.message} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="businessType">Business type</Label>
              <Controller
                name="industryId"
                control={control}
                rules={{ required: "Business type is required" }}
                render={({ field }) => (
                  <Select value={field.value || undefined} onValueChange={field.onChange} disabled={saving || industriesLoading}>
                    <SelectTrigger id="businessType" className={errors.industryId ? "w-full border-[#f41f20]" : "w-full"}>
                      <SelectValue placeholder={industriesLoading ? "Loading business types..." : "Business type"} />
                    </SelectTrigger>
                    <SelectContent>
                      {industries.map((industry) => (
                        <SelectItem key={industry.id} value={industry.id}>
                          {industry.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError message={errors.industryId?.message} />
              {industriesError && <p className="text-xs text-[#f41f20]">{industriesError.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="inventoryMarkup">Inventory markup (%)</Label>
              <Input
                id="inventoryMarkup"
                type="number"
                min={0}
                max={1000}
                step="0.01"
                disabled={saving}
                {...register("inventoryMarkup", {
                  required: "Markup percentage is required",
                  validate: (value) => markupFieldError(value) ?? true,
                })}
                className={errors.inventoryMarkup ? "border-[#f41f20]" : ""}
              />
              <FieldError message={errors.inventoryMarkup?.message} />
              <p className="text-xs text-muted-foreground">Stored as a whole percentage. 25 means 25%. Maximum is 1000. Used to calculate an inventory item's selling price from its purchase price.</p>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !isDirty}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function CompanySettings() {
  const { workspaceId } = useParams();
  const { data: workspace, isLoading, error, refetch, isFetched } = useGetWorkspace(workspaceId);

  if (!workspaceId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Company Information</CardTitle>
          <CardDescription>Update your company details and contact information</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Choose a company before editing its details.</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Company Information</CardTitle>
          <CardDescription>Update your company details and contact information</CardDescription>
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
    const message = error instanceof Error ? error.message : "Company details could not be loaded";
    return (
      <Card>
        <CardHeader>
          <CardTitle>Company Information</CardTitle>
          <CardDescription>Update your company details and contact information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-[#f41f20]">{message}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void refetch();
            }}
          >
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isFetched && !workspace) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Company Information</CardTitle>
          <CardDescription>Update your company details and contact information</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">You can only view and edit companies you belong to.</p>
        </CardContent>
      </Card>
    );
  }

  if (!workspace) return null;

  return <CompanyForm key={`${workspace.id}:${workspace.name}:${workspace.industryId ?? ""}:${workspace.inventoryMarkup ?? ""}`} workspace={workspace} />;
}
