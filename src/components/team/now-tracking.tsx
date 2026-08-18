"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent } from "@/components/ui/card";
import { usePresence, type PresenceEntry } from "@/hooks/use-presence";
import { formatDurationWords } from "@/lib/utils";
import { liveTodayMs } from "@/lib/live-timer";

const VERBS = ["is on", "is grinding", "is deep in", "is hammering"] as const;

function joinNames(names: string[]) {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function headline(others: PresenceEntry[]) {
  const who = joinNames(others.map((p) => p.name));
  if (others.length === 1) {
    return `${who} is also tracking.`;
  }
  return `${who} are also tracking. Race is on.`;
}

export function NowTracking() {
  const { data: session } = useSession();
  const { tracking, isLoading } = usePresence();
  const [now, setNow] = useState(() => Date.now());

  const others = tracking.filter((p) => p.userId !== session?.user?.id);

  useEffect(() => {
    if (others.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [others.length]);

  if (isLoading || others.length === 0) {
    return null;
  }

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="py-4 space-y-3">
        <p className="text-base font-semibold leading-snug text-balance">
          {headline(others)}
        </p>
        <ul className="space-y-1.5">
          {others.map((person, index) => {
            const elapsed = Math.max(0, now - person.startTime);
            const verb = VERBS[index % VERBS.length];
            return (
              <li
                key={person.userId}
                className="flex items-start gap-2 text-sm min-w-0"
              >
                <span className="relative mt-1.5 flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                </span>
                <p className="min-w-0 leading-snug font-medium">
                  {person.name} {verb} {person.taskName} ·{" "}
                  {formatDurationWords(elapsed)}
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    · {formatDurationWords(person.todayMs + liveTodayMs(person.startTime, now))} today
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
