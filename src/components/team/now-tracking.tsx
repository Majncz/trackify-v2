"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent } from "@/components/ui/card";
import { usePresence } from "@/hooks/use-presence";
import { formatDurationWords } from "@/lib/utils";

export function NowTracking() {
  const { data: session } = useSession();
  const { tracking, isLoading } = usePresence();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (tracking.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [tracking.length]);

  if (isLoading || tracking.length === 0) {
    return null;
  }

  const selfId = session?.user?.id;

  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-sm font-medium text-muted-foreground mb-3">
          Now tracking
        </p>
        <ul className="space-y-2.5">
          {tracking.map((person) => {
            const isYou = person.userId === selfId;
            const elapsed = Math.max(0, now - person.startTime);
            return (
              <li
                key={person.userId}
                className="flex items-center justify-between gap-3 min-w-0"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {isYou ? "You" : person.name}
                      {isYou && (
                        <span className="sr-only"> ({person.name})</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {person.taskName}
                    </p>
                  </div>
                </div>
                <p className="text-sm font-semibold tabular-nums shrink-0">
                  {formatDurationWords(elapsed)}
                </p>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
