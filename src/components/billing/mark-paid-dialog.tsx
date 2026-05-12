"use client";

import { useState, useEffect, useMemo } from "react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDurationMinutes, currencyUnitLabel } from "@/lib/format-money";
import type { BillingSessionRow } from "@/lib/billing";
import { billingSurface } from "@/lib/billing-ui";
import {
  resolveGroupAccent,
  taskAccentHex,
  groupAccentSoftBg,
} from "@/lib/group-accent";
import { cn } from "@/lib/utils";
import { CircleDollarSign, CalendarDays, Clock } from "lucide-react";

type MarkPaidDialogProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sessions: BillingSessionRow[];
  onSuccess: () => void;
};

const sectionKickerClass =
  "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

const fieldLabelClass = "text-xs font-medium text-foreground";

function accentForSession(s: BillingSessionRow): string {
  return s.taskGroup
    ? resolveGroupAccent(s.taskGroup)
    : taskAccentHex(s.taskId);
}

function parseLineAmount(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number.parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function localPaidAtToIso(paidDate: string, paidTime: string): string {
  return new Date(`${paidDate}T${paidTime}:00`).toISOString();
}

export function MarkPaidDialog({
  open,
  onOpenChange,
  sessions,
  onSuccess,
}: MarkPaidDialogProps) {
  const [paidDate, setPaidDate] = useState(() =>
    format(new Date(), "yyyy-MM-dd")
  );
  const [paidTime, setPaidTime] = useState(() =>
    format(new Date(), "HH:mm")
  );
  const [note, setNote] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const now = new Date();
    setPaidDate(format(now, "yyyy-MM-dd"));
    setPaidTime(format(now, "HH:mm"));
  }, [open]);

  useEffect(() => {
    if (!open || sessions.length === 0) return;
    const next: Record<string, string> = {};
    for (const s of sessions) {
      next[s.id] = String(s.earnings);
    }
    setAmounts(next);
    setError(null);
  }, [open, sessions]);

  const currency = sessions[0]?.currency ?? "CZK";

  const { lineTotal, amountsInvalid } = useMemo(() => {
    let sum = 0;
    let invalid = false;
    for (const s of sessions) {
      const parsed = parseLineAmount(amounts[s.id]);
      if (parsed === null) {
        invalid = true;
        continue;
      }
      sum += parsed;
    }
    return {
      lineTotal: Math.round(sum * 100) / 100,
      amountsInvalid: invalid,
    };
  }, [sessions, amounts]);

  const mins = sessions.reduce((a, s) => a + s.durationMinutes, 0);

  const allLinesMatchCalculated = useMemo(() => {
    if (sessions.length === 0) return true;
    return sessions.every((s) => {
      const parsed = parseLineAmount(amounts[s.id]);
      if (parsed === null) return false;
      return Math.abs(parsed - s.earnings) < 0.005;
    });
  }, [sessions, amounts]);

  function resetAllToCalculated() {
    setError(null);
    setAmounts(
      Object.fromEntries(sessions.map((s) => [s.id, String(s.earnings)]))
    );
  }

  async function handleSubmit() {
    setError(null);
    if (amountsInvalid || sessions.length === 0) {
      setError("Enter a valid amount (0 or more) for every session.");
      return;
    }
    setSubmitting(true);
    try {
      const paidAtIso = localPaidAtToIso(paidDate, paidTime);
      if (Number.isNaN(new Date(paidAtIso).getTime())) {
        setError("Choose a valid paid date and time.");
        setSubmitting(false);
        return;
      }
      const lineAmounts = Object.fromEntries(
        sessions.map((s) => {
          const n = parseLineAmount(amounts[s.id])!;
          return [s.id, n] as const;
        })
      );
      const res = await fetch("/api/billing/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventIds: sessions.map((s) => s.id),
          paidAt: paidAtIso,
          note: note.trim() || undefined,
          lineAmounts,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed to record payment");
      }
      onSuccess();
      onOpenChange(false);
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex h-[min(96dvh,56rem)] max-h-[96dvh] w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-4 sm:max-w-2xl sm:p-5",
          "duration-300 data-[state=open]:duration-300 data-[state=closed]:duration-200"
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 space-y-2 pr-8 text-left">
          <div className="flex items-start gap-2.5">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary shadow-sm"
              aria-hidden
            >
              <CircleDollarSign className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="min-w-0 space-y-0.5">
              <DialogTitle className="text-lg font-semibold tracking-tight">
                Mark as paid
              </DialogTitle>
              <DialogDescription className="text-xs leading-snug text-muted-foreground sm:text-[13px]">
                Total = sum of each line below. Override amounts only when
                needed.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div
          className={cn(
            billingSurface.inset,
            "mt-2 shrink-0 px-2.5 py-2"
          )}
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm tabular-nums">
            <span className="font-semibold text-foreground">
              {sessions.length}{" "}
              <span className="font-normal text-muted-foreground">
                session{sessions.length !== 1 ? "s" : ""}
              </span>
            </span>
            <span className="text-muted-foreground" aria-hidden>
              ·
            </span>
            <span className="text-foreground">{formatDurationMinutes(mins)}</span>
            <span className="text-muted-foreground" aria-hidden>
              ·
            </span>
            <span className="font-semibold text-foreground">
              {formatMoney(lineTotal, currency)}
            </span>
          </div>
        </div>

        <div
          className={cn(
            billingSurface.section,
            "mt-2 flex min-h-0 flex-1 flex-col"
          )}
        >
          <div
            className={cn(
              billingSurface.sectionHeader,
              "flex flex-wrap items-center justify-between gap-2 py-1.5"
            )}
          >
            <p className="text-xs font-semibold leading-none sm:text-sm">
              Sessions
            </p>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] sm:h-8 sm:text-xs"
                disabled={sessions.length === 0 || allLinesMatchCalculated}
                onClick={resetAllToCalculated}
                aria-label="Reset all line amounts to calculated values"
              >
                Reset to calculated
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 bg-muted/20">
            <div
              className="h-full max-h-full overflow-y-auto overscroll-y-contain px-1.5 py-1.5 [scrollbar-gutter:stable] sm:px-2 sm:py-2"
              role="list"
              aria-label="Sessions included in this payment"
            >
              <ul className="flex flex-col gap-1.5">
                {sessions.map((s) => {
                  const accent = accentForSession(s);
                  const fromDate = new Date(s.from);
                  const toDate = new Date(s.to);
                  const timeRange = `${format(fromDate, "MMM d, yyyy")} · ${format(fromDate, "HH:mm")}–${format(toDate, "HH:mm")}`;
                  const raw = amounts[s.id];
                  const parsed = parseLineAmount(raw);
                  const lineInvalid = parsed === null;

                  return (
                    <li key={s.id}>
                      <div
                        className={cn(
                          billingSurface.row({ interactive: false }),
                          "px-2 py-1.5 sm:px-2.5 sm:py-1.5"
                        )}
                        style={{
                          backgroundColor: groupAccentSoftBg(accent, 0.06),
                        }}
                        role="listitem"
                      >
                        <div className="flex flex-col gap-1.5 min-[500px]:flex-row min-[500px]:items-center min-[500px]:gap-3">
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0">
                              <p className="text-sm font-semibold leading-tight text-foreground">
                                {s.taskName}
                              </p>
                              {s.taskGroup ? (
                                <Badge
                                  variant="outline"
                                  className="h-4 border-0 px-1 py-0 text-[10px] font-normal leading-none"
                                  style={{
                                    color: accent,
                                    backgroundColor: groupAccentSoftBg(
                                      accent,
                                      0.2
                                    ),
                                  }}
                                >
                                  {s.taskGroup.name}
                                </Badge>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0 text-[11px] leading-tight text-muted-foreground tabular-nums sm:text-xs">
                              <span className="min-w-0">{timeRange}</span>
                              <span className="text-border" aria-hidden>
                                ·
                              </span>
                              <Badge
                                variant="secondary"
                                className="h-4 shrink-0 px-1 py-0 text-[10px] font-normal tabular-nums leading-none"
                              >
                                {formatDurationMinutes(s.durationMinutes)}
                              </Badge>
                              <span className="text-border" aria-hidden>
                                ·
                              </span>
                              <span>
                                Calc{" "}
                                <span className="font-medium text-foreground">
                                  {formatMoney(s.earnings, s.currency)}
                                </span>
                              </span>
                            </div>
                          </div>

                          <div
                            className={cn(
                              "flex min-w-0 shrink-0 items-center gap-1.5 min-[500px]:justify-end",
                              "min-[500px]:max-w-[11rem] sm:max-w-[12rem]"
                            )}
                          >
                            <Label htmlFor={`amt-${s.id}`} className="sr-only">
                              Amount to record for {s.taskName} (
                              {currencyUnitLabel(s.currency)})
                            </Label>
                            <Input
                              id={`amt-${s.id}`}
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step={0.01}
                              aria-invalid={lineInvalid}
                              className={cn(
                                "h-8 min-w-0 flex-1 px-2 text-right text-sm font-medium tabular-nums min-[500px]:max-w-[7.5rem] sm:max-w-[8rem]",
                                lineInvalid &&
                                  "border-destructive focus-visible:ring-destructive"
                              )}
                              aria-label={`Amount to record for ${s.taskName} in ${currencyUnitLabel(s.currency)}`}
                              placeholder="0"
                              value={raw ?? ""}
                              onChange={(e) =>
                                setAmounts((m) => ({
                                  ...m,
                                  [s.id]: e.target.value,
                                }))
                              }
                            />
                            <span
                              className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground"
                              aria-hidden
                            >
                              {currencyUnitLabel(s.currency)}
                            </span>
                          </div>
                        </div>
                        {lineInvalid ? (
                          <p className="mt-1 text-[10px] font-medium text-destructive min-[500px]:text-right">
                            Enter a valid amount (0 or more).
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>

        <div className="shrink-0 space-y-2 border-t border-border pt-3">
          <div>
            <p className={sectionKickerClass}>Payment details</p>
            <div className="mt-2 grid gap-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="paid-date" className={fieldLabelClass}>
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden
                      />
                      Paid on
                    </span>
                  </Label>
                  <Input
                    id="paid-date"
                    type="date"
                    value={paidDate}
                    onChange={(e) => setPaidDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="paid-time" className={fieldLabelClass}>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden
                      />
                      Paid at time
                    </span>
                  </Label>
                  <Input
                    id="paid-time"
                    type="time"
                    step={60}
                    value={paidTime}
                    onChange={(e) => setPaidTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pay-note" className={fieldLabelClass}>
                  Note{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="pay-note"
                  placeholder="Invoice #, reference…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={2000}
                />
              </div>
            </div>
            {error ? (
              <p
                className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="space-y-0">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Total to record
              </span>
              <p className="text-xl font-bold tabular-nums tracking-tight text-foreground sm:text-2xl">
                {formatMoney(lineTotal, currency)}
              </p>
            </div>

            <DialogFooter className="w-full gap-2 pt-0 sm:w-auto sm:justify-end sm:gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="min-w-[9rem] font-semibold"
                onClick={() => void handleSubmit()}
                disabled={
                  submitting || sessions.length === 0 || amountsInvalid
                }
              >
                {submitting ? "Saving…" : "Mark as paid"}
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
