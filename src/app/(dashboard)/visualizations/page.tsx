import { VisualizationsClient } from "@/components/visualizations/visualizations-client";

export default function VisualizationsPage() {
  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="min-w-0 space-y-1">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Visualizations</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Play the hours back and watch the team race
        </p>
      </div>
      <VisualizationsClient />
    </div>
  );
}
