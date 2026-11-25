import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Frown } from "lucide-react";
import { cn } from "../../lib/utils";
import { useIsProblemClient, useSetClientProblem } from "./useProblemClients";

/** Red sad-face mark for a problem client (with a tooltip). */
export function ProblemClientIcon({ className }: { className?: string }) {
  const { t } = useTranslation();
  const label = t("clients.problem.badge");
  return (
    <span
      className="inline-flex shrink-0"
      title={label}
      role="img"
      aria-label={label}
      data-testid="problem-client-icon"
    >
      <Frown className={cn("size-4 text-red-600 dark:text-red-400", className)} aria-hidden />
    </span>
  );
}

/**
 * A client's name as shown in lists / cards: red with the mark when the client is flagged as a problem
 * client, otherwise unchanged (the caller's own classes apply).
 */
export function ClientNameWithMark({
  clientId,
  children,
  className,
}: {
  clientId: string | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  const problem = useIsProblemClient(clientId);
  if (!problem) return <>{children}</>;
  return (
    <span
      className={cn("inline-flex min-w-0 max-w-full items-center gap-1 text-red-600 dark:text-red-400", className)}
      data-problem-client="true"
    >
      <span className="min-w-0 truncate">{children}</span>
      <ProblemClientIcon />
    </span>
  );
}

/** Client card header: mark / unmark the client as a problem client. */
export function ProblemClientToggle({ clientId, disabled = false }: { clientId: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const problem = useIsProblemClient(clientId);
  const { mutate, isPending } = useSetClientProblem();
  return (
    <button
      type="button"
      disabled={disabled || isPending}
      aria-pressed={problem}
      data-testid="problem-client-toggle"
      onClick={() => mutate({ clientId, isProblem: !problem })}
      title={problem ? t("clients.problem.unmark") : t("clients.problem.markHint")}
      className={cn(
        "inline-flex min-h-8 w-fit items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:opacity-60",
        problem
          ? "border-red-600/40 bg-red-600/10 text-red-700 hover:bg-red-600/15 dark:text-red-300"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Frown className="size-3.5" aria-hidden />
      {problem ? t("clients.problem.badgeRemovable") : t("clients.problem.mark")}
    </button>
  );
}
