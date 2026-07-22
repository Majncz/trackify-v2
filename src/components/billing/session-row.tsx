"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDurationMinutes } from "@/lib/format-money";
import type { BillingSessionRow } from "@/lib/billing";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { billingSurface, BILLING_SESSION_ACCENT_WASH_ALPHA } from "@/lib/billing-ui";
import {
  resolveGroupAccent,
  taskAccentHex,
  groupAccentSoftBg,
  hexToRgba,
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
  /** Match `PaymentSessionLine` in history: soft accent wash; skip when primary selection tint applies. */
  const accentCardWash = groupAccentSoftBg(
    accent,
    BILLING_SESSION_ACCENT_WASH_ALPHA
  );
  const useAccentWash = !(rowInteractive && selected);
  const selectedChromeStyle =
    rowInteractive && selected
      ? {
          borderColor: hexToRgba(accent, 0.55),
          backgroundColor: groupAccentSoftBg(accent, 0.22),
          boxShadow: `0 0 0 1px ${hexToRgba(accent, 0.35)}, 0 2px 8px -2px ${hexToRgba(accent, 0.2)}`,
        }
      : null;

  /** Inset focus so keyboard affordance does not fight the outer accent border. */
  const sessionRowFocus =
    "outline-none transition-[box-shadow,background-color,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30";

  function toggleFromRow() {
    if (!rowInteractive) return;
    onToggleSelected(session.id, !selected);
  }

  return (
    <div
      role={rowInteractive ? "button" : undefined}
      tabIndex={rowInteractive ? 0 : undefined}
      className={cn(
        "flex w-full min-w-0 flex-col gap-2 p-2.5 sm:flex-row sm:items-center sm:gap-3 sm:p-3",
        rowInteractive && sessionRowFocus,
        billingSurface.row({
          paid: session.isPaid,
          interactive: rowInteractive,
        }),
        !rowInteractive && "cursor-default"
      )}
      style={{
        ...(selectedChromeStyle ??
          (useAccentWash ? { backgroundColor: accentCardWash } : {})),
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
