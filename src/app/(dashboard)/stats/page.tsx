import { StatsPageClient } from "@/components/stats/stats-page-client";

export default function StatsPage() {
  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="min-w-0 space-y-1">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Stats</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Analyse your tracked time
        </p>
      </div>
      <StatsPageClient />
    </div>
  );
}
