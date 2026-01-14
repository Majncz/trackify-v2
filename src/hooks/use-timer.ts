"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSocket } from "./use-socket";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface TimerState {
  taskId: string | null;
  startTime: number | null;
  elapsed: number;
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

interface Event {
  id: string;
  taskId: string;
  name: string;
  duration: number;
  createdAt: string;
}

interface Task {
  id: string;
  name: string;
  events: Event[];
}

export function useTimer() {
  const [state, setState] = useState<TimerState>({
    taskId: null,
    startTime: null,
    elapsed: 0,
    running: false,
  });
  const [socketError, setSocketError] = useState<string | null>(null);

  const intervalRef = useRef<NodeJS.Timeout>();
  const stateRef = useRef(state);
  const previousStartTimeRef = useRef<number | null>(null);
  const { emit, on, isConnected, requestTimerState } = useSocket();
  const queryClient = useQueryClient();

  // Keep ref in sync with state for callbacks
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Update elapsed time
  useEffect(() => {
    if (state.running && state.startTime) {
      intervalRef.current = setInterval(() => {
        setState((prev) => ({
          ...prev,
          elapsed: Math.max(0, Date.now() - prev.startTime!),
        }));
      }, 100);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [state.running, state.startTime]);

  // Listen for real-time updates
  useEffect(() => {
    const unsubStart = on("timer:started", (data) => {
      const { taskId, startTime } = data as TimerStartedData;
      // Only update if not already running this task (avoids overwriting local state)
      if (stateRef.current.taskId === taskId && stateRef.current.running) {
        return;
      }
      setState({
        taskId,
        startTime,
        elapsed: Math.max(0, Date.now() - startTime),
        running: true,
      });
    });

    const unsubStop = on("timer:stopped", () => {
      setState({
        taskId: null,
        startTime: null,
        elapsed: 0,
        running: false,
      });
      // Invalidate queries to refresh stats
      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    });

    const unsubState = on("timer:state", (data) => {
      const { taskId, startTime, running } = data as TimerStateData;
      if (running) {
        setState({
          taskId,
          startTime,
          elapsed: Math.max(0, Date.now() - startTime),
          running: true,
        });
      }
    });

    const unsubStartUpdated = on("timer:start-updated", (data) => {
      const { taskId, startTime } = data as TimerStartUpdatedData;
      // Only update if this is the current running timer
      if (stateRef.current.taskId === taskId && stateRef.current.running) {
        setState({
          ...stateRef.current,
          startTime,
          elapsed: Math.max(0, Date.now() - startTime),
        });
        // Clear the previous start time ref since update succeeded
        previousStartTimeRef.current = null;
      }
    });

    const unsubError = on("timer:error", (data) => {
      const { action, message } = data as TimerErrorData;
      if (action === "update-start") {
        // Roll back optimistic update if we have a previous start time
        if (previousStartTimeRef.current !== null && stateRef.current.running) {
          setState({
            ...stateRef.current,
            startTime: previousStartTimeRef.current,
            elapsed: Math.max(0, Date.now() - previousStartTimeRef.current),
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
  }, [on, queryClient]);

  // Request timer state when socket connects
  useEffect(() => {
    if (isConnected) {
      requestTimerState();
    }
  }, [isConnected, requestTimerState]);

  const createEvent = useMutation({
    mutationFn: async (data: {
      taskId: string;
      name: string;
      duration: number;
      createdAt: string; // ISO timestamp of when the timer started
    }) => {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to create event");
      }
      return res.json();
    },
    onMutate: async (newEvent) => {
      // Cancel outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      await queryClient.cancelQueries({ queryKey: ["stats"] });

      // Snapshot previous values
      const previousTasks = queryClient.getQueryData(["tasks"]);

      // Optimistically update tasks cache with new event
      queryClient.setQueryData(["tasks"], (old: Task[] | undefined) => {
        if (!old) return old;
        return old.map((task) => {
          if (task.id === newEvent.taskId) {
            return {
              ...task,
              events: [
                ...task.events,
                {
                  id: `temp-${Date.now()}`,
                  taskId: newEvent.taskId,
                  name: newEvent.name,
                  duration: newEvent.duration,
                  createdAt: newEvent.createdAt,
                },
              ],
            };
          }
          return task;
        });
      });

      return { previousTasks };
    },
    onError: (_err, _newEvent, context) => {
      // Roll back on error
      if (context?.previousTasks) {
        queryClient.setQueryData(["tasks"], context.previousTasks);
      }
    },
    onSettled: () => {
      // Sync with server after mutation completes
      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const stopTimer = useCallback(() => {
    const currentState = stateRef.current;
    if (!currentState.taskId || !currentState.startTime) return;

    const duration = Date.now() - currentState.startTime;
    const taskId = currentState.taskId;
    const startTime = currentState.startTime;

    // IMMEDIATELY update UI - user sees instant response
    setState({
      taskId: null,
      startTime: null,
      elapsed: 0,
      running: false,
    });

    emit("timer:stop", { taskId, duration });

    // Save to database in background (don't block UI)
    createEvent.mutate({
      taskId,
      name: "Time entry",
      duration,
      createdAt: new Date(startTime).toISOString(),
    });
  }, [emit, createEvent]);

  const startTimer = useCallback(
    (taskId: string) => {
      // If a timer is already running, stop it first (saves the event)
      if (stateRef.current.running && stateRef.current.taskId) {
        stopTimer();
      }

      const startTime = Date.now();
      emit("timer:start", { taskId });
      setState({
        taskId,
        startTime,
        elapsed: 0,
        running: true,
      });
    },
    [emit, stopTimer]
  );

  // Clear error after it's been shown
  const clearError = useCallback(() => {
    createEvent.reset();
  }, [createEvent]);

  const adjustStartTimeMutation = useMutation({
    mutationFn: async (newStartTime: number): Promise<void> => {
      // Clear any previous socket error at the start
      setSocketError(null);

      // First validate the new start time
      const validateRes = await fetch("/api/timer/validate-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newStartTime: new Date(newStartTime).toISOString(),
        }),
      });

      if (!validateRes.ok) {
        const errorData = await validateRes.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to validate start time");
      }

      // If validation passes, emit socket event to update start time
      const currentState = stateRef.current;
      if (!currentState.taskId || !currentState.running) {
        throw new Error("No active timer to adjust");
      }

      // Store previous start time for potential rollback if socket fails
      previousStartTimeRef.current = currentState.startTime;

      // Emit the update request - the socket will handle the update
      // and broadcast timer:start-updated to all devices
      emit("timer:update-start", {
        taskId: currentState.taskId,
        newStartTime,
      });

      // Optimistically update local state immediately
      setState({
        ...currentState,
        startTime: newStartTime,
        elapsed: Math.max(0, Date.now() - newStartTime),
      });
    },
  });

  const adjustStartTime = useCallback(
    async (newStartTime: number) => {
      return adjustStartTimeMutation.mutateAsync(newStartTime);
    },
    [adjustStartTimeMutation]
  );

  const clearAdjustError = useCallback(() => {
    adjustStartTimeMutation.reset();
    setSocketError(null);
  }, [adjustStartTimeMutation]);

  // Combine mutation error with socket error
  const adjustError = adjustStartTimeMutation.error || (socketError ? new Error(socketError) : null);

  return {
    ...state,
    startTimer,
    stopTimer,
    adjustStartTime,
    isCreatingEvent: createEvent.isPending,
    createEventError: createEvent.error,
    isAdjustingStartTime: adjustStartTimeMutation.isPending,
    adjustStartTimeError: adjustError,
    clearError,
    clearAdjustError,
  };
}
