"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen, X } from "lucide-react";

const LS_KEY = "billing-guide-dismissed";

type BillingGuideProps = {
  onOpenTasksTab: () => void;
};

export function BillingGuide({ onOpenTasksTab }: BillingGuideProps) {
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setReady(true);
    try {
      if (localStorage.getItem(LS_KEY) === "1") {
        setVisible(false);
      }
    } catch {
      /* private mode */
    }
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(LS_KEY, "1");
    } catch {
      /* ignore */
    }
    setVisible(false);
  }, []);

  if (!ready || !visible) return null;

  return (
    <Card className="border-primary/25 bg-primary/5">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <BookOpen className="h-4 w-4" />
            </div>
            <div className="space-y-1 min-w-0">
              <CardTitle className="text-base">How billing works</CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                Same idea as Stats: pick a range, read the chart, act on the list.
                You don&apos;t log time here—only money-related steps.
              </CardDescription>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 h-8 w-8"
            onClick={dismiss}
            aria-label="Hide guide"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <ol className="list-decimal marker:font-medium pl-4 space-y-2.5 text-sm text-muted-foreground leading-relaxed">
          <li>
            <span className="text-foreground font-medium">Rates</span> tab:
            choose which existing tasks have a rate (that&apos;s the only
            setup).
          </li>
          <li>
            Track time on the <span className="text-foreground font-medium">home</span>{" "}
            dashboard as usual—billing only reads it.
          </li>
          <li>
            <span className="text-foreground font-medium">Sessions</span> tab:
            set filters (period, task group, single task, paid/unpaid), then use
            the list.
          </li>
          <li>
            Tap an <span className="text-foreground font-medium">unpaid row</span>{" "}
            to select it (or use the checkbox), then{" "}
            <span className="text-foreground font-medium">Mark as paid…</span>{" "}
            one currency per batch. Past batches live under{" "}
            <span className="text-foreground font-medium">History</span>.
          </li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onOpenTasksTab}>
            Open billable tasks
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={dismiss}>
            Don&apos;t show this again
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
