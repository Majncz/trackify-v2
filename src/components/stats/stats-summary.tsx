"use client";

import { useStats } from "@/hooks/use-stats";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatDurationWords } from "@/lib/utils";

export function StatsSummary() {
  const { data: stats, isLoading } = useStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="py-6">
            <div className="animate-pulse h-16 bg-gray-200 rounded"></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-6">
            <div className="animate-pulse h-16 bg-gray-200 rounded"></div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <h3 className="text-sm font-medium text-gray-500">Today</h3>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-gray-900">
            {formatDurationWords(stats?.todayTotal ?? 0)}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h3 className="text-sm font-medium text-gray-500">All Time</h3>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-gray-900">
            {formatDurationWords(stats?.grandTotal ?? 0)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
