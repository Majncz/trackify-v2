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

export function useTimer() {
  const [state, setState] = useState<TimerState>({
    taskId: null,
    startTime: null,
    elapsed: 0,
    running: false,
  });

  const intervalRef = useRef<NodeJS.Timeout>();
  const stateRef = useRef(state);
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
          elapsed: Date.now() - prev.startTime!,
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
      setState({
        taskId,
        startTime,
        elapsed: Date.now() - startTime,
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
          elapsed: Date.now() - startTime,
          running: true,
        });
      }
    });

    return () => {
      unsubStart();
      unsubStop();
      unsubState();
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const stopTimer = useCallback(async () => {
    const currentState = stateRef.current;
    if (!currentState.taskId || !currentState.startTime) return;

    const duration = Date.now() - currentState.startTime;

    emit("timer:stop", {
      taskId: currentState.taskId,
      duration,
    });

    // Create event in database with the actual start time
    await createEvent.mutateAsync({
      taskId: currentState.taskId,
      name: "Time entry",
      duration,
      createdAt: new Date(currentState.startTime).toISOString(),
    });

    setState({
      taskId: null,
      startTime: null,
      elapsed: 0,
      running: false,
    });
  }, [emit, createEvent]);

  const startTimer = useCallback(
    async (taskId: string) => {
      // If a timer is already running, stop it first (saves the event)
      if (stateRef.current.running && stateRef.current.taskId) {
        await stopTimer();
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

  return {
    ...state,
    startTimer,
    stopTimer,
    isCreatingEvent: createEvent.isPending,
  };
}
