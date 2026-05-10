import { BillingPage } from "@/components/billing/billing-page";

export default function Page() {
  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="min-w-0 space-y-1">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Billing</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Rates on tasks, billable sessions, and marking them paid—same chart
          style as Stats where it helps.
        </p>
      </div>
      <BillingPage />
    </div>
  );
}
