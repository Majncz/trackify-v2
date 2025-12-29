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
  const { emit, on } = useSocket();
  const queryClient = useQueryClient();

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

  const createEvent = useMutation({
    mutationFn: async (data: {
      taskId: string;
      name: string;
      duration: number;
    }) => {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create event");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const startTimer = useCallback(
    (taskId: string) => {
      emit("timer:start", { taskId });
      setState({
        taskId,
        startTime: Date.now(),
        elapsed: 0,
        running: true,
      });
    },
    [emit]
  );

  const stopTimer = useCallback(async () => {
    if (!state.taskId || !state.startTime) return;

    const duration = Date.now() - state.startTime;

    emit("timer:stop", {
      taskId: state.taskId,
      duration,
    });

    // Create event in database
    await createEvent.mutateAsync({
      taskId: state.taskId,
      name: "Time entry",
      duration,
    });

    setState({
      taskId: null,
      startTime: null,
      elapsed: 0,
      running: false,
    });
  }, [state, emit, createEvent]);

  return {
    ...state,
    startTimer,
    stopTimer,
    isCreatingEvent: createEvent.isPending,
  };
}
