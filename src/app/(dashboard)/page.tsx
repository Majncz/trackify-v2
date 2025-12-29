import { TaskList } from "@/components/tasks/task-list";
import { StatsSummary } from "@/components/stats/stats-summary";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">Track your time efficiently</p>
      </div>

      <StatsSummary />
      <TaskList />
    </div>
  );
}
