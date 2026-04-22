import { useEffect, useMemo, useState } from "react";
import { formatDuration, secondsSince } from "./lib/time";

const defaultProjects = [
  { id: "project-1", name: "Trackify Platform" },
  { id: "project-2", name: "Client Work" },
];

const defaultTasks = [
  { id: "task-1", projectId: "project-1", name: "Desktop app" },
  { id: "task-2", projectId: "project-1", name: "API integration" },
  { id: "task-3", projectId: "project-2", name: "Meeting" },
];

export function App() {
  const [projectId, setProjectId] = useState(defaultProjects[0].id);
  const [taskId, setTaskId] = useState<string | undefined>(undefined);
  const [note, setNote] = useState("");
  const [startedAt, setStartedAt] = useState<string | null>(null);

  const [elapsed, setElapsed] = useState(0);
  const running = Boolean(startedAt);

  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }

    const tick = () => setElapsed(secondsSince(startedAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const filteredTasks = useMemo(
    () => defaultTasks.filter((task) => task.projectId === projectId),
    [projectId],
  );

  useEffect(() => {
    if (taskId && !filteredTasks.some((task) => task.id === taskId)) {
      setTaskId(undefined);
    }
  }, [filteredTasks, taskId]);

  const todayTotal = running ? elapsed : 0;

  return (
    <div className="panel-root">
      <header>
        <div className="label">Trackify Desktop</div>
        <h1>Quick Tracker</h1>
      </header>

      <div className="status-card">
        <div>
          <div className="status-label">Current</div>
          <div className="status-value">{running ? "Running" : "Idle"}</div>
        </div>
        <div className="clock">{formatDuration(elapsed)}</div>
      </div>

      <div className="form-grid">
        <label>
          Project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {defaultProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Task
          <select
            value={taskId ?? ""}
            onChange={(e) => setTaskId(e.target.value || undefined)}
          >
            <option value="">No specific task</option>
            {filteredTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Note
          <textarea
            placeholder="What are you working on?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>

      <div className="actions">
        {!running ? (
          <button className="button-primary" onClick={() => setStartedAt(new Date().toISOString())}>
            Start timer
          </button>
        ) : (
          <button className="button-danger" onClick={() => setStartedAt(null)}>
            Stop timer
          </button>
        )}
      </div>

      <footer>
        <span>Today total</span>
        <strong>{formatDuration(todayTotal)}</strong>
      </footer>
    </div>
  );
}
