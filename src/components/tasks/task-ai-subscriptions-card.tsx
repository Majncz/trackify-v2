"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

type PeriodRow = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  metrics: { isActive: boolean };
};

async function fetchPeriodsList(): Promise<{ periods: PeriodRow[] }> {
  const res = await fetch("/api/ai-subscriptions/periods");
  if (!res.ok) throw new Error("Failed to load AI periods");
  return res.json();
}

async function fetchTaskLinks(
  taskId: string
): Promise<{ periodIds: string[] }> {
  const res = await fetch(`/api/tasks/${taskId}/ai-subscriptions`);
  if (!res.ok) throw new Error("Failed to load links");
  return res.json();
}

type TaskAiSubscriptionsCardProps = {
  taskId: string;
};

export function TaskAiSubscriptionsCard({
  taskId,
}: TaskAiSubscriptionsCardProps) {
  const qc = useQueryClient();

  const periodsQuery = useQuery({
    queryKey: ["ai-subscriptions-periods-list"],
    queryFn: fetchPeriodsList,
  });

  const linksQuery = useQuery({
    queryKey: ["task-ai-subscriptions", taskId],
    queryFn: () => fetchTaskLinks(taskId),
  });

  const [selected, setSelected] = useState(() => new Set<string>());
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!linksQuery.data) return;
    setSelected(new Set(linksQuery.data.periodIds));
    setDirty(false);
  }, [linksQuery.data]);

  const save = useMutation({
    mutationFn: async (periodIds: string[]) => {
      const res = await fetch(`/api/tasks/${taskId}/ai-subscriptions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodIds }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not save");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-ai-subscriptions", taskId] });
      qc.invalidateQueries({ queryKey: ["ai-subscriptions-analytics"] });
      qc.invalidateQueries({ queryKey: ["ai-subscriptions-periods-list"] });
      setDirty(false);
    },
  });

  const periods = periodsQuery.data?.periods ?? [];

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (checked) n.add(id);
      else n.delete(id);
      return n;
    });
    setDirty(true);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg">AI subscriptions</CardTitle>
            <CardDescription>
              Link this task to one or more subscription periods so tracked time
              counts toward those tools&apos; metrics.{" "}
              <Link
                href="/billing#ai-tools"
                className="text-primary underline-offset-4 hover:underline"
              >
                Manage in Billing → AI tools
              </Link>
              .
            </CardDescription>
          </div>
          {dirty ? (
            <Button
              type="button"
              size="sm"
              disabled={save.isPending}
              onClick={() => save.mutate(Array.from(selected))}
            >
              {save.isPending ? "Saving…" : "Save links"}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {periodsQuery.isLoading || linksQuery.isLoading ? (
          <Skeleton className="h-32 w-full rounded-lg" />
        ) : periodsQuery.isError ? (
          <p className="text-sm text-destructive">Could not load periods.</p>
        ) : periods.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No subscription periods yet. Add them under Billing → AI tools.
          </p>
        ) : (
          <ScrollArea className="h-[min(220px,40vh)] rounded-md border pr-3">
            <ul className="space-y-2 p-3">
              {periods.map((p) => (
                <li key={p.id} className="flex items-start gap-3 py-1.5">
                  <Checkbox
                    id={`ai-sub-${p.id}`}
                    checked={selected.has(p.id)}
                    onCheckedChange={(c) => toggle(p.id, c === true)}
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <Label
                      htmlFor={`ai-sub-${p.id}`}
                      className="text-sm font-medium leading-tight cursor-pointer"
                    >
                      {p.name}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {new Date(p.startsAt).toLocaleDateString()}
                      {p.endsAt
                        ? ` – ${new Date(p.endsAt).toLocaleDateString()}`
                        : " → ongoing"}
                    </p>
                  </div>
                  {p.metrics.isActive ? (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      Active
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
        {save.error ? (
          <p className="text-sm text-destructive">
            {(save.error as Error).message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
