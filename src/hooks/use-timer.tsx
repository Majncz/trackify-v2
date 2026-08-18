"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import { useSocket } from "./use-socket";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  adoptServerRunning,
  clearRunning,
  enqueueStart,
  enqueueStop,
  hasPendingWork,
  markRunningSynced,
  pendingStopTaskIds,
  readTimerQueue,
  updateRunningStart,
} from "@/lib/timer-draft";
import { fetchServerTimer, persistStoppedTimer } from "@/lib/timer-sync";
import {
  kickTimerDurability,
  TIMER_SYNC_EVENT,
  type TimerSyncDetail,
} from "@/lib/timer-durability";

interface TimerState {
  taskId: string | null;
  startTime: number | null;
  running: boolean;
}

interface TimerStartedData {
  taskId: string;
  startTime: number;
}

interface TimerStateData {
  taskId: string;
  startTime: number;
  running: boolean;
}

interface TimerStartUpdatedData {
  taskId: string;
  startTime: number;
}

interface TimerErrorData {
  action: string;
  message: string;
}

function useTimerController() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const [state, setState] = useState<TimerState>({
    taskId: null,
    startTime: null,
    running: false,
  });
  const [socketError, setSocketError] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const [pendingSaveTaskIds, setPendingSaveTaskIds] = useState<string[]>([]);

  const stateRef = useRef(state);
  const previousStartTimeRef = useRef<number | null>(null);
  const userIdRef = useRef<string | undefined>(userId);
  const { emit, on, isConnected, requestTimerState } = useSocket();
  const queryClient = useQueryClient();
  const [startError, setStartError] = useState<Error | null>(null);

  userIdRef.current = userId;

  const refreshPendingStops = useCallback(() => {
    setPendingSaveTaskIds(pendingStopTaskIds(readTimerQueue(userIdRef.current)));
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applyRunning = useCallback(
    (taskId: string, startTime: number, pending: boolean) => {
      setPendingConfirmation(pending);
      setState({
        taskId,
        startTime,
        running: true,
      });
    },
    []
  );

  const applyIdle = useCallback(() => {
    setState({
      taskId: null,
      startTime: null,
      running: false,
    });
  }, []);

  useEffect(() => {
    function onSync(event: Event) {
      const detail = (event as CustomEvent<TimerSyncDetail>).detail;
      if (!detail) return;
      refreshPendingStops();
      if (detail.result === "ok" && detail.kind === "running") {
        if (stateRef.current.taskId === detail.taskId) {
          setPendingConfirmation(false);
          setStartError(null);
        }
        return;
      }
      if (detail.result === "ok" && detail.kind === "stopping") {
        setPendingConfirmation(false);
        queryClient.invalidateQueries({ queryKey: ["events"] });
        queryClient.invalidateQueries({ queryKey: ["stats"] });
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        return;
      }
      if (detail.result === "rejected" && detail.kind === "running") {
        setStartError(new Error(detail.error));
        if (stateRef.current.taskId === detail.taskId) {
          setPendingConfirmation(false);
          applyIdle();
        }
        return;
      }
      if (detail.result === "rejected" && detail.kind === "stopping") {
        setStartError(new Error(detail.error));
      }
    }

    window.addEventListener(TIMER_SYNC_EVENT, onSync);
    return () => window.removeEventListener(TIMER_SYNC_EVENT, onSync);
  }, [applyIdle, queryClient, refreshPendingStops]);

  useEffect(() => {
    const unsubStart = on("timer:started", (data) => {
      const { taskId, startTime } = data as TimerStartedData;
      const queue = readTimerQueue(userIdRef.current);
      if (hasPendingWork(queue)) return;
      adoptServerRunning({
        userId: userIdRef.current,
        taskId,
        startTime,
      });
      if (stateRef.current.taskId === taskId && stateRef.current.running) {
        setPendingConfirmation(false);
        return;
      }
      applyRunning(taskId, startTime, false);
    });

    const unsubStop = on("timer:stopped", (data) => {
      const stopped = data as { taskId?: string };
      const queue = readTimerQueue(userIdRef.current);
      if (hasPendingWork(queue)) return;
      if (
        stopped.taskId &&
        stateRef.current.taskId &&
        stopped.taskId !== stateRef.current.taskId
      ) {
        return;
      }
      if (queue.running && stopped.taskId && queue.running.taskId === stopped.taskId) {
        clearRunning(userIdRef.current);
      }
      if (stateRef.current.running) {
        setPendingConfirmation(false);
        applyIdle();
      }
      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    });

    const unsubState = on("timer:state", (data) => {
      const { taskId, startTime, running } = data as TimerStateData;
      const queue = readTimerQueue(userIdRef.current);
      if (hasPendingWork(queue)) return;
      if (running) {
        adoptServerRunning({
          userId: userIdRef.current,
          taskId,
          startTime,
        });
        applyRunning(taskId, startTime, false);
      }
    });

    const unsubStartUpdated = on("timer:start-updated", (data) => {
      const { taskId, startTime } = data as TimerStartUpdatedData;
      if (stateRef.current.taskId === taskId && stateRef.current.running) {
        updateRunningStart(startTime, userIdRef.current);
        markRunningSynced(userIdRef.current);
        setState({
          ...stateRef.current,
          startTime,
        });
        previousStartTimeRef.current = null;
      }
    });

    const unsubError = on("timer:error", (data) => {
      const { action, message } = data as TimerErrorData;
      if (action === "update-start") {
        if (previousStartTimeRef.current !== null && stateRef.current.running) {
          setState({
            ...stateRef.current,
            startTime: previousStartTimeRef.current,
          });
        }
        previousStartTimeRef.current = null;
        setSocketError(message);
      }
    });

    return () => {
      unsubStart();
      unsubStop();
      unsubState();
      unsubStartUpdated();
      unsubError();
    };
  }, [on, queryClient, applyIdle, applyRunning]);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const queue = readTimerQueue(userId);
      refreshPendingStops();
      if (queue.running) {
        applyRunning(queue.running.taskId, queue.running.startTime, !queue.running.synced);
      }

      const server = await fetchServerTimer();
      if (cancelled) return;

      const current = readTimerQueue(userId);
      if (hasPendingWork(current)) {
        kickTimerDurability();
        return;
      }

      if (server.status === "unknown") {
        return;
      }

      if (server.status === "ok" && server.running) {
        adoptServerRunning({
          userId,
          taskId: server.taskId,
          startTime: server.startTime,
        });
        applyRunning(server.taskId, server.startTime, false);
        return;
      }

      if (server.status === "ok" && !server.running && current.running?.synced) {
        clearRunning(userId);
        applyIdle();
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [userId, applyIdle, applyRunning, refreshPendingStops]);

  useEffect(() => {
    if (isConnected) {
      requestTimerState();
      kickTimerDurability();
    }
  }, [isConnected, requestTimerState]);

  const stopTimer = useCallback(() => {
    const currentState = stateRef.current;
    if (!currentState.taskId || !currentState.startTime) return;

    const taskId = currentState.taskId;
    const startTime = currentState.startTime;
    const endTime = Date.now();

    enqueueStop({
      userId: userIdRef.current,
      taskId,
      startTime,
      endTime,
    });
    refreshPendingStops();
    setPendingConfirmation(true);
    applyIdle();

    emit("timer:stop", { taskId, duration: endTime - startTime });
    void persistStoppedTimer(taskId);
    kickTimerDurability();
  }, [emit, applyIdle, refreshPendingStops]);

  const startTimer = useCallback(
    (taskId: string) => {
      const previous = stateRef.current;
      if (previous.running && previous.taskId && previous.startTime) {
        emit("timer:stop", {
          taskId: previous.taskId,
          duration: Date.now() - previous.startTime,
        });
        void persistStoppedTimer(previous.taskId);
      }

      const startTime = Date.now();
      enqueueStart({
        userId: userIdRef.current,
        taskId,
        startTime,
      });
      refreshPendingStops();
      setStartError(null);
      applyRunning(taskId, startTime, true);
      emit("timer:start", { taskId, startTime });
      kickTimerDurability();
    },
    [emit, applyRunning, refreshPendingStops]
  );

  const clearError = useCallback(() => {
    setStartError(null);
  }, []);

  const finishSessionMutation = useMutation({
    mutationFn: async ({
      startTime: nextStart,
      endTime,
    }: {
      startTime: number;
      endTime: number | null;
    }): Promise<void> => {
      setSocketError(null);
      const currentState = stateRef.current;
      if (!currentState.taskId || !currentState.running || !currentState.startTime) {
        throw new Error("No active timer to adjust");
      }

      const taskId = currentState.taskId;
      const now = Date.now();
      const startTime = nextStart;
      if (startTime > now) {
        throw new Error("Start time cannot be in the future");
      }

      if (endTime == null) {
        if (startTime === currentState.startTime) return;

        const validateRes = await fetch("/api/timer/validate-start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            newStartTime: new Date(startTime).toISOString(),
          }),
        });

        if (!validateRes.ok) {
          const errorData = await validateRes.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to validate start time");
        }

        previousStartTimeRef.current = currentState.startTime;
        updateRunningStart(startTime, userIdRef.current);

        const updateRes = await fetch("/api/timer", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId,
            newStartTime: new Date(startTime).toISOString(),
          }),
        });

        if (!updateRes.ok) {
          const errorData = await updateRes.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to update start time");
        }

        markRunningSynced(userIdRef.current);
        emit("timer:update-start", { taskId, newStartTime: startTime });
        setState({ ...currentState, startTime });
        return;
      }

      const stopAt = Math.min(endTime, now);
      if (stopAt <= startTime) {
        throw new Error("End time must be after start time");
      }

      previousStartTimeRef.current = currentState.startTime;
      updateRunningStart(startTime, userIdRef.current);
      enqueueStop({
        userId: userIdRef.current,
        taskId,
        startTime,
        endTime: stopAt,
      });
      refreshPendingStops();
      setPendingConfirmation(true);
      applyIdle();
      emit("timer:stop", { taskId, duration: stopAt - startTime });
      void persistStoppedTimer(taskId);
      kickTimerDurability();
    },
  });

  const finishSession = useCallback(
    async (session: { startTime: number; endTime: number | null }) => {
      return finishSessionMutation.mutateAsync(session);
    },
    [finishSessionMutation]
  );

  const adjustStartTime = useCallback(
    async (newStartTime: number) => {
      return finishSession({ startTime: newStartTime, endTime: null });
    },
    [finishSession]
  );

  const clearAdjustError = useCallback(() => {
    finishSessionMutation.reset();
    setSocketError(null);
  }, [finishSessionMutation]);

  const adjustError = finishSessionMutation.error || (socketError ? new Error(socketError) : null);
  const pendingSaveTaskId = pendingSaveTaskIds[0] ?? null;

  return {
    ...state,
    pendingConfirmation,
    pendingSaveTaskId,
    pendingSaveTaskIds,
    startTimer,
    stopTimer,
    finishSession,
    adjustStartTime,
    isCreatingEvent: pendingSaveTaskIds.length > 0,
    createEventError: startError,
    isAdjustingStartTime: finishSessionMutation.isPending,
    adjustStartTimeError: adjustError,
    clearError,
    clearAdjustError,
  };
}

type TimerContextValue = ReturnType<typeof useTimerController>;

const TimerContext = createContext<TimerContextValue | null>(null);

export function TimerProvider({ children }: { children: ReactNode }) {
  const value = useTimerController();
  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

export function useLiveTimer() {
  const ctx = useContext(TimerContext);
  if (!ctx) {
    throw new Error("useLiveTimer must be used within a TimerProvider");
  }
  return {
    running: ctx.running,
    taskId: ctx.taskId,
    startTime: ctx.startTime,
  };
}

export function useTimer() {
  const ctx = useContext(TimerContext);
  if (!ctx) {
    throw new Error("useTimer must be used within a TimerProvider");
  }
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!ctx.running || !ctx.startTime) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.max(0, Date.now() - ctx.startTime!));
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [ctx.running, ctx.startTime]);

  return { ...ctx, elapsed };
}
