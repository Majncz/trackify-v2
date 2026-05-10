"use client";

import { useState } from "react";
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
import { formatMoney, formatDurationMinutes } from "@/lib/format-money";
import type { BillingSessionRow } from "@/lib/billing";

type MarkPaidDialogProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sessions: BillingSessionRow[];
  onSuccess: () => void;
};

export function MarkPaidDialog({
  open,
  onOpenChange,
  sessions,
  onSuccess,
}: MarkPaidDialogProps) {
  const [paidAt, setPaidAt] = useState(() =>
    format(new Date(), "yyyy-MM-dd'T'HH:mm")
  );
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = sessions[0]?.currency ?? "CZK";
  const total = sessions.reduce((a, s) => a + s.earnings, 0);
  const mins = sessions.reduce((a, s) => a + s.durationMinutes, 0);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const paidAtIso = new Date(paidAt).toISOString();
      const res = await fetch("/api/billing/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventIds: sessions.map((s) => s.id),
          paidAt: paidAtIso,
          note: note.trim() || undefined,
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            This locks in the selected sessions as paid and adds them to History.
            You can reopen a batch from History if you made a mistake.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            You are marking{" "}
            <span className="font-medium text-foreground">{sessions.length}</span>{" "}
            session{sessions.length !== 1 ? "s" : ""} (
            {formatDurationMinutes(mins)}) as paid for{" "}
            <span className="font-semibold tabular-nums">
              {formatMoney(total, currency)}
            </span>
            .
          </p>
          <div className="space-y-1">
            <Label htmlFor="paid-at">Payment date</Label>
            <Input
              id="paid-at"
              type="datetime-local"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pay-note">Note (optional)</Label>
            <Input
              id="pay-note"
              placeholder="Invoice #, reference…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || sessions.length === 0}>
            {submitting ? "Saving…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
