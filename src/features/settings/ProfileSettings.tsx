import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Save } from "lucide-react";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Skeleton } from "../../ui/Skeleton";
import { Avatar, AvatarFallback } from "../../ui/Avatar";
import { Separator } from "../../ui/Separator";
import { useGetProfile } from "../profiles/useGetProfile";
import { useUpdateProfile } from "../profiles/useUpdateProfile";
import { profileDisplayName, profileInitials } from "../profiles/profileName";
import type { ProfileRecord, UpdateProfileInput } from "../../services/apiProfiles";

const phonePattern = /^\+[1-9]\d{7,14}$/;

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

function ProfileForm({ profile }: { profile: ProfileRecord }) {
  const { t } = useTranslation();
  const { mutateAsync, isPending } = useUpdateProfile();
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<UpdateProfileInput>({
    defaultValues: {
      fullName: profile.full_name ?? "",
      phone: profile.phone ?? "",
    },
  });

  const displayName = profileDisplayName(profile.full_name);
  const saving = isPending || isSubmitting;

  async function onSubmit(values: UpdateProfileInput) {
    if (!isDirty) return;
    try {
      await mutateAsync(values);
    } catch {
      return;
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.profile.title")}</CardTitle>
        <CardDescription>{t("settings.profile.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-6">
          <Avatar className="h-20 w-20">
            <AvatarFallback className="bg-primary text-xl text-primary-foreground">{profileInitials(displayName)}</AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium text-foreground">{displayName}</p>
            <p className="text-sm text-muted-foreground">{profile.email || t("settings.profile.noEmail")}</p>
          </div>
        </div>

        <Separator />

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="profile-full-name">{t("settings.profile.fullNameLabel")}</Label>
              <Input
                id="profile-full-name"
                {...register("fullName", {
                  required: t("settings.profile.validation.fullNameRequired"),
                  validate: (value) => value.trim().length > 0 || t("settings.profile.validation.fullNameRequired"),
                })}
                disabled={saving}
                className={errors.fullName ? "border-destructive" : ""}
              />
              <FieldError message={errors.fullName?.message} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-email">{t("settings.profile.emailLabel")}</Label>
              <Input id="profile-email" type="email" value={profile.email ?? ""} readOnly />
              <p className="text-xs text-muted-foreground">{t("settings.profile.emailHint")}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-phone">{t("settings.profile.phoneLabel")}</Label>
              <Input
                id="profile-phone"
                {...register("phone", {
                  validate: (value) => !value.trim() || phonePattern.test(value.trim()) || t("settings.profile.validation.phoneFormat"),
                })}
                placeholder="+37300000000"
                disabled={saving}
                className={errors.phone ? "border-destructive" : ""}
              />
              <FieldError message={errors.phone?.message} />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !isDirty}>
              <Save />
              {saving ? t("common.saving") : t("common.saveChanges")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ProfileSettings() {
  const { t } = useTranslation();
  const { data: profile, isLoading, error, refetch } = useGetProfile();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.profile.title")}</CardTitle>
          <CardDescription>{t("settings.profile.description")}</CardDescription>
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
    const message = error instanceof Error ? error.message : t("settings.profile.loadFailed");
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.profile.title")}</CardTitle>
          <CardDescription>{t("settings.profile.description")}</CardDescription>
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

  if (!profile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.profile.title")}</CardTitle>
          <CardDescription>{t("settings.profile.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("settings.profile.missing")}</p>
        </CardContent>
      </Card>
    );
  }

  return <ProfileForm key={`${profile.id}:${profile.full_name ?? ""}:${profile.phone ?? ""}`} profile={profile} />;
}
