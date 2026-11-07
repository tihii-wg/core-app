import { formatTeamNames, teamAvatarSlice } from "./orderTeam";

type OrderTeamAvatarsProps = {
  team: Array<{ employeeId: string; name: string }>;
  maxVisible?: number;
};

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function OrderTeamAvatars({ team, maxVisible = 3 }: OrderTeamAvatarsProps) {
  if (team.length === 0) return null;

  const { visible, overflow } = teamAvatarSlice(team, maxVisible);

  return (
    <div className="flex items-center -space-x-1.5" title={formatTeamNames(team)}>
      {visible.map((member) => (
        <span
          key={member.employeeId}
          className="inline-flex size-6 items-center justify-center rounded-full border border-border bg-muted text-xs font-medium text-foreground"
        >
          {initials(member.name) || "?"}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-border bg-muted px-1 text-xs text-muted-foreground">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
