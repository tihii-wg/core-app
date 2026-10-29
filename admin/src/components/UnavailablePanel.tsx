import { Ban } from "lucide-react";
import { Card } from "./ui";

export function UnavailablePanel({ title, description }: { title: string; description: string }) {
  return (
    <Card className="border-[color-mix(in_oklab,var(--muted)_35%,var(--border))] p-6">
      <div className="flex gap-3">
        <Ban className="mt-0.5 size-5 shrink-0 text-[var(--muted)]" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-[var(--fg)]">{title}</p>
          <p className="text-sm text-[var(--muted)]">{description}</p>
        </div>
      </div>
    </Card>
  );
}
