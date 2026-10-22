import { Controller, useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { Building2, Save } from "lucide-react";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Skeleton } from "../../ui/Skeleton";
import { Separator } from "../../ui/Separator";
import { Switch } from "../../ui/Switch";
import { Textarea } from "../../ui/Textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { useGetIndustries } from "../industries/useGetIndustries";
import { industryName } from "../industries/industryName";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useUpdateWorkspace, useUpdateWorkspaceTaxInvoiceSettings } from "../workspaces/useUpdateWorkspace";
import { parseMarkupPercent, markupFieldError } from "../inventory/markup";
import type { WorkspaceDetails } from "../../services/apiWorkspaces";
import { CompanyLogoControls } from "./CompanyLogoControls";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { canManageWorkspace } from "../workspaces/workspaceRoles";

type CompanyFormValues = {
  name: string;
  industryId: string;
  inventoryMarkup: string;
  companyAddress: string;
  billingEmail: string;
  registrationNumber: string;
  taxVatNumber: string;
  iban: string;
  bankName: string;
  bankCode: string;
  companyDescription: string;
  printExtraInfo: string;
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
      companyAddress: workspace.companyAddress ?? "",
      billingEmail: workspace.billingEmail ?? "",
      registrationNumber: workspace.registrationNumber ?? "",
      taxVatNumber: workspace.taxVatNumber ?? "",
      iban: workspace.iban ?? "",
      bankName: workspace.bankName ?? "",
      bankCode: workspace.bankCode ?? "",
      companyDescription: workspace.companyDescription ?? "",
      printExtraInfo: workspace.printExtraInfo ?? "",
    },
  });

  const saving = isSavingWorkspace || isSubmitting;
  const canEdit = canManageWorkspace(workspace.role);
  const locked = saving || !canEdit;

  const { mutateAsync: saveTaxInvoiceSetting, isPending: taxInvoiceSaving } = useUpdateWorkspaceTaxInvoiceSettings();
  const [taxInvoiceEnabled, setTaxInvoiceEnabled] = useState(workspace.requireTaxInvoiceNumber);
  useEffect(() => {
    setTaxInvoiceEnabled(workspace.requireTaxInvoiceNumber);
  }, [workspace.requireTaxInvoiceNumber]);

  async function handleTaxInvoiceToggle(next: boolean) {
    setTaxInvoiceEnabled(next);
    try {
      await saveTaxInvoiceSetting({ workspaceId: workspace.id, requireTaxInvoiceNumber: next });
      toast.success(t("settings.company.taxInvoice.toast.saved"), { id: "tax-invoice-settings" });
    } catch (error) {
      setTaxInvoiceEnabled(!next);
      toast.error(error instanceof Error ? error.message : t("settings.company.taxInvoice.toast.failed"), { id: "tax-invoice-settings" });
    }
  }

  async function onSubmit(values: CompanyFormValues) {
    const markupMessage = markupFieldError(values.inventoryMarkup);
    if (markupMessage) {
      setError("inventoryMarkup", { message: markupMessage });
      return;
    }

    const inventoryMarkup = parseMarkupPercent(values.inventoryMarkup);
    if (inventoryMarkup == null) return;

    const email = values.billingEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("billingEmail", { message: t("settings.company.validation.billingEmailInvalid") });
      return;
    }

    try {
      await saveWorkspace({
        workspaceId: workspace.id,
        name: values.name,
        industryId: values.industryId,
        inventoryMarkup,
        companyAddress: values.companyAddress,
        billingEmail: values.billingEmail,
        registrationNumber: values.registrationNumber,
        taxVatNumber: values.taxVatNumber,
        iban: values.iban,
        bankName: values.bankName,
        bankCode: values.bankCode,
        companyDescription: values.companyDescription,
        printExtraInfo: values.printExtraInfo,
      });
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
                      {workspace.industryId && !industries.some((industry) => industry.id === workspace.industryId) ? (
                        <SelectItem value={workspace.industryId}>
                          {workspace.industrySlug
                            ? industryName({ name: workspace.industryName ?? "", slug: workspace.industrySlug })
                            : (workspace.industryName ?? workspace.industryId)}
                        </SelectItem>
                      ) : null}
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

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="companyAddress">{t("settings.company.addressLabel")}</Label>
              <Input id="companyAddress" {...register("companyAddress")} disabled={locked} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="billingEmail">{t("settings.company.billingEmailLabel")}</Label>
              <Input id="billingEmail" type="email" {...register("billingEmail")} disabled={locked} className={errors.billingEmail ? "border-destructive" : ""} />
              <FieldError message={errors.billingEmail?.message} />
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

            <div className="space-y-2">
              <Label htmlFor="registrationNumber">{t("settings.company.registrationNumberLabel")}</Label>
              <Input id="registrationNumber" {...register("registrationNumber")} disabled={locked} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="taxVatNumber">{t("settings.company.taxVatNumberLabel")}</Label>
              <Input id="taxVatNumber" {...register("taxVatNumber")} disabled={locked} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="iban">{t("settings.company.ibanLabel")}</Label>
              <Input id="iban" {...register("iban")} disabled={locked} className="font-mono text-sm" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bankName">{t("settings.company.bankNameLabel")}</Label>
              <Input id="bankName" {...register("bankName")} disabled={locked} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bankCode">{t("settings.company.bankCodeLabel")}</Label>
              <Input id="bankCode" {...register("bankCode")} disabled={locked} />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="companyDescription">{t("settings.company.descriptionLabel")}</Label>
              <Textarea id="companyDescription" rows={3} {...register("companyDescription")} disabled={locked} />
              <p className="text-xs text-muted-foreground">{t("settings.company.descriptionHint")}</p>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="printExtraInfo">{t("settings.company.printExtraInfoLabel")}</Label>
              <Textarea id="printExtraInfo" rows={3} {...register("printExtraInfo")} disabled={locked} />
              <p className="text-xs text-muted-foreground">{t("settings.company.printExtraInfoHint")}</p>
            </div>
          </div>

          {canEdit ? (
            <div className="flex justify-end">
              <Button type="submit" disabled={saving || !isDirty}>
                <Save />
                {saving ? t("common.saving") : t("settings.company.save")}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("settings.company.ownerOnly")}</p>
          )}
        </form>

        <Separator />

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="requireTaxInvoiceNumber">{t("settings.company.taxInvoice.label")}</Label>
            <p className="text-xs text-muted-foreground">{t("settings.company.taxInvoice.description")}</p>
          </div>
          <Switch
            id="requireTaxInvoiceNumber"
            checked={taxInvoiceEnabled}
            onCheckedChange={(checked) => void handleTaxInvoiceToggle(checked)}
            disabled={!canEdit || taxInvoiceSaving}
            aria-label={t("settings.company.taxInvoice.label")}
          />
        </div>
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
          <Button type="button" variant="outline" onClick={() => void refetch()}>
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

  return (
    <CompanyForm
      key={`${workspace.id}:${workspace.name}:${workspace.industryId ?? ""}:${workspace.inventoryMarkup ?? ""}:${workspace.companyAddress}:${workspace.billingEmail}`}
      workspace={workspace}
    />
  );
}
