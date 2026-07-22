import { TaskList } from "@/components/tasks/task-list";
import { StatsSummary } from "@/components/stats/stats-summary";
import { TimeChart } from "@/components/stats/time-chart";
import { CreateTaskModal } from "@/components/tasks/create-task-modal";

export default function DashboardPage() {
  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Dashboard</h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            Track your time efficiently
          </p>
        </div>
        <div className="shrink-0">
          <CreateTaskModal />
        </div>
      </div>

      <TaskList />
      <TimeChart />
      <StatsSummary />
    </div>
  );
}
