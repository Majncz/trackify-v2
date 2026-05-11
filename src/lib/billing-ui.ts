import { cn } from "@/lib/utils";

/** Soft tint behind session-style rows (history lines; ledger skips when selected). */
export const BILLING_SESSION_ACCENT_WASH_ALPHA = 0.12;

/** Shared surfaces for Billing (Sessions, Rates, History) — clearer separation on light UI. */
export const billingSurface = {
  /** Primary list rows (sessions, rate tasks, history line items) */
  row: (opts?: { paid?: boolean; interactive?: boolean }) =>
    cn(
      "rounded-lg border-2 border-border bg-card text-card-foreground shadow-sm transition-[box-shadow,background-color,border-color]",
      opts?.interactive &&
        "cursor-pointer hover:border-foreground/20 hover:bg-muted/40 hover:shadow-md",
      opts?.paid && "border-muted-foreground/25 bg-muted/45"
    ),

  /** Group / section shells */
  section: cn(
    "rounded-xl border-2 border-border bg-card text-card-foreground shadow-sm overflow-hidden"
  ),

  sectionHeader: cn(
    "border-b-2 border-border bg-muted/55 px-3 py-2 sm:px-3.5"
  ),

  /** Toolbar / filter strips */
  toolbar: cn(
    "rounded-lg border-2 border-border bg-card/95 shadow-md backdrop-blur-sm supports-[backdrop-filter]:bg-card/90"
  ),

  /** Nested panel inside a card (e.g. rate rules) */
  inset: cn("rounded-md border border-border bg-muted/35 p-3 shadow-inner"),
} as const;
