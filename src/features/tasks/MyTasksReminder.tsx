import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { BellRing, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "../../ui/Button";
import { cn } from "../../lib/utils";
import { isTaskOverdue } from "../../services/apiTasks";
import { useStatusLookup } from "../stage9/useStatusLookup";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { TaskItem } from "./TaskItem";
import { useMyOpenTasks } from "./useGetTasks";
import { useSetTaskState } from "./useTaskMutations";
import { useTeamDirectory } from "./useTeamDirectory";

const VISIBLE = 3;
const COLLAPSE_KEY = "core-app:tasks-reminder-collapsed";

function readCollapsed() {
  try {
    return sessionStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Always-visible reminder of open tasks assigned to the signed-in user, shown above every page
 * until each task is done. It can be folded to one line but never hidden while tasks are open.
 */
export function MyTasksReminder() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { locale = "en", workspaceId } = useParams();
  const { data: tasks = [] } = useMyOpenTasks();
  const team = useTeamDirectory();
  const statuses = useStatusLookup();
  const setState = useSetTaskState();
  const { canWrite } = useWorkspaceSubscription();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [expanded, setExpanded] = useState(false);

  if (tasks.length === 0) return null;
  if (location.pathname.split("/")[3] === "tasks") return null;

  const overdue = tasks.filter((task) => isTaskOverdue(task)).length;
  const shown = expanded ? tasks : tasks.slice(0, VISIBLE);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      sessionStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // ignore storage failures
    }
  }

  return (
    <section
      aria-label={t("stage9.tasks.reminder.aria")}
      className={cn(
        "mb-5 rounded-xl border-2 shadow-sm print:hidden",
        overdue ? "border-destructive/60 bg-destructive/5" : "border-warning/70 bg-warning/10",
      )}
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full text-white",
            overdue ? "bg-destructive" : "bg-warning",
          )}
        >
          <BellRing className="size-5 motion-safe:animate-[pulse_2s_ease-in-out_infinite]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{t("stage9.tasks.reminder.title", { count: tasks.length })}</p>
          <p className="text-[13px] text-muted-foreground">
            {overdue ? t("stage9.tasks.reminder.overdue", { count: overdue }) : t("stage9.tasks.reminder.hint")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => navigate(`/${locale}/${workspaceId}/tasks`)}>
            {t("stage9.tasks.reminder.open")}
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={collapsed ? t("stage9.tasks.reminder.expand") : t("stage9.tasks.reminder.collapse")}
            onClick={toggleCollapsed}
          >
            {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </Button>
        </div>
      </div>

      {!collapsed ? (
        <div className="space-y-2 px-4 pb-4">
          {shown.map((task) => {
            const status = task.statusId ? statuses.get(task.statusId) : undefined;
            return (
              <TaskItem
                key={task.id}
                task={task}
                compact
                assigneeName={null}
                authorName={team.nameOf(task.createdBy)}
                inProgress={status?.statusGroup === "in_progress"}
                canChangeState={canWrite}
                canEdit={false}
                busy={setState.isPending}
                onState={(state) => setState.mutate({ id: task.id, state })}
              />
            );
          })}
          {tasks.length > VISIBLE ? (
            <button
              type="button"
              className="text-[13px] font-medium text-primary hover:underline"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? t("stage9.tasks.reminder.showLess") : t("stage9.tasks.reminder.showMore", { count: tasks.length - VISIBLE })}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
