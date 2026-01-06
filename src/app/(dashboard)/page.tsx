import { TaskList } from "@/components/tasks/task-list";
import { StatsSummary } from "@/components/stats/stats-summary";
import { CreateTaskModal } from "@/components/tasks/create-task-modal";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">Track your time efficiently</p>
        </div>
        <CreateTaskModal />
      </div>

      <TaskList />
      <StatsSummary />
    </div>
  );
}
