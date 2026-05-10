"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDurationMinutes } from "@/lib/format-money";
import type { BillingSessionRow } from "@/lib/billing";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  resolveGroupAccent,
  taskAccentHex,
  groupAccentSoftBg,
} from "@/lib/group-accent";

type SessionRowProps = {
  session: BillingSessionRow;
  selected: boolean;
  onToggleSelected: (id: string, next: boolean) => void;
  disabledCheckbox?: boolean;
};

function accentForSession(s: BillingSessionRow): string {
  return s.taskGroup
    ? resolveGroupAccent(s.taskGroup)
    : taskAccentHex(s.taskId);
}

export function SessionRow({
  session,
  selected,
  onToggleSelected,
  disabledCheckbox,
}: SessionRowProps) {
  const fromDate = new Date(session.from);
  const toDate = new Date(session.to);
  const timeRange = `${format(fromDate, "MMM d, yyyy")} · ${format(fromDate, "HH:mm")}–${format(toDate, "HH:mm")}`;
  const accent = accentForSession(session);
  const rowInteractive = !session.isPaid && !disabledCheckbox;

  function toggleFromRow() {
    if (!rowInteractive) return;
    onToggleSelected(session.id, !selected);
  }

  return (
    <div
      role={rowInteractive ? "button" : undefined}
      tabIndex={rowInteractive ? 0 : undefined}
      className={cn(
        "flex flex-col gap-2 rounded-md border bg-background/50 p-3 sm:flex-row sm:items-center sm:gap-3 transition-colors",
        "border-l-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected && "ring-1 ring-primary/30",
        rowInteractive && "cursor-pointer hover:bg-muted/30",
        !rowInteractive && "cursor-default"
      )}
      style={{
        borderLeftColor: accent,
        backgroundColor: rowInteractive
          ? undefined
          : groupAccentSoftBg(accent, 0.06),
      }}
      onClick={toggleFromRow}
      onKeyDown={(e) => {
        if (!rowInteractive) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleFromRow();
        }
      }}
    >
      <div
        className="flex items-start gap-2 sm:min-w-[2.25rem]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Checkbox
          id={`sess-${session.id}`}
          checked={selected}
          disabled={disabledCheckbox || session.isPaid}
          onCheckedChange={(v) => onToggleSelected(session.id, Boolean(v))}
          aria-label={
            session.isPaid
              ? "Session already paid"
              : "Select session to include in payment"
          }
        />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2 gap-y-1">
          <p className="text-sm font-medium leading-tight">{session.taskName}</p>
          {session.taskGroup ? (
            <Badge
              variant="outline"
              className="text-[10px] font-normal px-1.5 py-0 h-5 border-0"
              style={{
                color: accent,
                backgroundColor: groupAccentSoftBg(accent, 0.18),
              }}
            >
              {session.taskGroup.name}
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">{timeRange}</p>
        {session.isPaid && session.paymentPaidAt && (
          <p className="text-xs text-muted-foreground">
            Paid {format(new Date(session.paymentPaidAt), "MMM d, yyyy")}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
        <Badge variant="secondary" className="tabular-nums">
          {formatDurationMinutes(session.durationMinutes)}
        </Badge>
        <span className="text-sm font-semibold tabular-nums">
          {formatMoney(session.earnings, session.currency)}
        </span>
        <Badge variant={session.isPaid ? "default" : "outline"}>
          {session.isPaid ? "Paid" : "Unpaid"}
        </Badge>
      </div>
    </div>
  );
}
