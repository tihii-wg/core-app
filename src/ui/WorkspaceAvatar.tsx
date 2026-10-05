import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "./Avatar";
import { workspaceInitials } from "../features/workspaces/workspaceInitials";
import { cn } from "../lib/utils";

const sizes = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-32 text-3xl",
};

export function WorkspaceAvatar({ name, imageUrl, size = "sm", className }: { name: string; imageUrl?: string | null; size?: keyof typeof sizes; className?: string }) {
  const { t } = useTranslation();
  return (
    <Avatar className={cn(sizes[size], className)}>
      {/* Kept mounted: Radix only resets its "loaded" state (which hides the fallback) when src changes. */}
      <AvatarImage src={imageUrl ?? undefined} alt={t("nav.workspace.logoAlt", { name })} />
      <AvatarFallback className="bg-primary font-medium text-primary-foreground">{workspaceInitials(name)}</AvatarFallback>
    </Avatar>
  );
}
