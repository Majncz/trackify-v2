"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useEffect, useState, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatTabBar } from "@/components/chat/chat-tab-bar";
import {
  Send,
  Loader2,
  Bot,
  Check,
  Square,
  AlertCircle,
  X,
} from "lucide-react";

// Shared constants
export const TOOL_DESCRIPTIONS: Record<string, string> = {
  listTasks: "Get all your tasks",
  findTask: "Search for a task",
  listEvents: "List time entries",
  createTask: "Create a new task",
  createEvent: "Log time to a task",
  getStats: "Get time statistics",
  deleteEvent: "Delete a time entry",
  updateEvent: "Update a time entry",
};

export const WRITE_TOOLS = ["createTask", "createEvent", "deleteEvent", "updateEvent"];

// Helper functions (outside component to avoid recreation)
function formatToolName(name: string): string {
  return TOOL_DESCRIPTIONS[name] || name;
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getToolDescription(name: string, args: Record<string, unknown>): string {
  if (name === "createEvent") {
    const taskName = args.taskName ? `"${args.taskName}"` : "task";
    const duration = args.duration ? formatDuration(args.duration as number) : "";
    const date = args.createdAt ? formatDate(args.createdAt as string) : "now";
    return `Log ${duration} to ${taskName} on ${date}`;
  }
  if (name === "createTask") {
    return `Create task "${args.name}"`;
  }
  if (name === "deleteEvent") {
    return `Delete time entry`;
  }
  if (name === "updateEvent") {
    const changes: string[] = [];
    if (args.newDate) changes.push(`move to ${formatDate(args.newDate as string)}`);
    if (args.newDuration) changes.push(`change duration to ${formatDuration(args.newDuration as number)}`);
    return changes.length > 0 ? changes.join(" and ") : "Update time entry";
  }
  return Object.entries(args)
    .filter(([k]) => !k.includes("Id"))
    .map(([k, v]) => {
      if (k === "duration" && typeof v === "number") return formatDuration(v);
      if (k === "createdAt" && typeof v === "string") return formatDate(v);
      return `${k}: ${v}`;
    })
    .join(", ");
}

function formatArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([k]) => !k.includes("Id"))
    .map(([k, v]) => {
      if (k === "duration" && typeof v === "number") return formatDuration(v);
      if (k === "createdAt" && typeof v === "string") return formatDate(v);
      return `${k}: ${v}`;
    })
    .join(", ");
}

interface ChatInterfaceProps {
  variant?: "page" | "sidebar";
  showTabBar?: boolean;
  header?: ReactNode;
}

export function ChatInterface({ variant = "page", showTabBar = true, header }: ChatInterfaceProps) {
  const isSidebar = variant === "sidebar";
  const queryClient = useQueryClient();
  
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, "pending" | "approved" | "rejected" | "executing">>({});
  const [tabRefreshTrigger, setTabRefreshTrigger] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const conversationIdRef = useRef(conversationId);

  function updateConversationId(id: string | null) {
    conversationIdRef.current = id;
    setConversationId(id);
  }

  const { messages, setMessages, sendMessage: originalSendMessage, status, stop, error, addToolOutput } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: async (url, options) => {
        if (options?.body) {
          const body = JSON.parse(options.body as string);
          body.conversationId = conversationIdRef.current;
          body.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          return fetch(url, {
            ...options,
            body: JSON.stringify(body),
          });
        }
        return fetch(url, options);
      },
    }),
  });

  const sendMessage = originalSendMessage;
  const isLoading = status === "streaming" || status === "submitted";

  // Load messages when conversation changes
  useEffect(() => {
    setPendingApprovals({});

    if (!conversationId) {
      setMessages([]);
      return;
    }

    let cancelled = false;

    async function loadMessages() {
      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages`);
        if (cancelled) return;
        if (res.ok) {
          const dbMessages = await res.json();
          if (cancelled) return;
          // Don't clear messages if DB has none - preserves optimistic UI messages
          if (dbMessages.length === 0) return;
          const uiMessages = dbMessages.map((msg: { id: string; role: string; content: string; parts?: unknown[] }) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            parts: msg.parts || (msg.content ? [{ type: "text", text: msg.content }] : []),
          }));
          setMessages(uiMessages);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load messages:", err);
        }
      }
    }

    loadMessages();
    return () => { cancelled = true; };
  }, [conversationId, setMessages]);

  async function ensureConversation(): Promise<string | null> {
    if (conversationIdRef.current) return conversationIdRef.current;

    try {
      const res = await fetch("/api/conversations", { method: "POST" });
      if (res.ok) {
        const newConv = await res.json();
        conversationIdRef.current = newConv.id;
        setConversationId(newConv.id);
        return newConv.id;
      }
    } catch (err) {
      console.error("Failed to create conversation:", err);
    }
    return null;
  }

  async function handleToolApproval(toolCallId: string, toolName: string, args: Record<string, unknown>) {
    setPendingApprovals((prev) => ({ ...prev, [toolCallId]: "executing" }));

    try {
      const response = await fetch("/api/chat/execute-tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolName, args, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });

      const result = await response.json();
      
      // Check if the tool execution itself failed (success: false)
      if (result.success === false) {
        setPendingApprovals((prev) => ({ ...prev, [toolCallId]: "rejected" }));
        // Pass the error to the AI so it can inform the user
        await addToolOutput({ toolCallId, tool: toolName, output: result });
        sendMessage();
        return;
      }
      
      setPendingApprovals((prev) => ({ ...prev, [toolCallId]: "approved" }));
      await addToolOutput({ toolCallId, tool: toolName, output: result });
      
      // Invalidate queries after successful write operations to refresh frontend data
      if (WRITE_TOOLS.includes(toolName)) {
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        queryClient.invalidateQueries({ queryKey: ["stats"] });
        queryClient.invalidateQueries({ queryKey: ["events"] });
      }
      
      sendMessage();
    } catch (err) {
      console.error("Tool execution failed:", err);
      setPendingApprovals((prev) => ({ ...prev, [toolCallId]: "rejected" }));
      await addToolOutput({ toolCallId, tool: toolName, output: { success: false, error: "Network error - please try again" } });
      sendMessage();
    }
  }

  async function handleToolRejection(toolCallId: string, toolName: string) {
    setPendingApprovals((prev) => ({ ...prev, [toolCallId]: "rejected" }));
    await addToolOutput({ toolCallId, tool: toolName, output: { rejected: true, message: "User rejected this action" } });
    sendMessage();
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === "streaming" && status === "ready") {
      setTabRefreshTrigger((prev) => prev + 1);
    }
    prevStatusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (!isSidebar) {
      inputRef.current?.focus();
    }
  }, [isSidebar]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const convId = await ensureConversation();
    if (!convId) {
      console.error("Failed to create conversation");
      return;
    }

    sendMessage({ text: input });
    setInput("");
  }

  async function handleExampleClick(text: string) {
    const convId = await ensureConversation();
    if (!convId) {
      console.error("Failed to create conversation");
      return;
    }
    sendMessage({ text });
  }

  // Size classes based on variant
  const textSize = isSidebar ? "text-xs" : "text-sm";
  const spacing = isSidebar ? "space-y-2" : "space-y-4";
  const padding = isSidebar ? "px-2 py-1" : "px-3 py-2";
  const iconSize = isSidebar ? "h-3 w-3" : "h-4 w-4";

  return (
    <div className={cn("relative flex flex-col", isSidebar ? "h-full" : "h-full")}>
      {header && (
        <div className="shrink-0 border-b bg-background">
          {header}
        </div>
      )}
      {/* Tab Bar */}
      {showTabBar && (
        <ChatTabBar
          currentConversationId={conversationId}
          onConversationChange={updateConversationId}
          refreshTrigger={tabRefreshTrigger}
        />
      )}

      {/* Messages */}
      <div className={cn("flex-1 overflow-y-auto", spacing, isSidebar ? "px-2 pb-4" : "pb-24 md:pb-4")}>
        {messages.length === 0 && !error && (
          <div className={cn(
            "flex flex-col items-center justify-center text-center text-muted-foreground",
            isSidebar ? "h-full py-4" : "min-h-[50vh]"
          )}>
            <Bot className={isSidebar ? "h-8 w-8 mb-2" : "h-12 w-12 mb-4"} />
            <p className={cn("font-medium text-foreground", isSidebar ? "text-sm mb-1" : "text-lg mb-2")}>
              How can I help?
            </p>
            <p className={cn("mb-4", textSize)}>Try something like:</p>
            <div className={cn("w-full", textSize, isSidebar ? "space-y-1.5 px-2" : "space-y-2 max-w-md")}>
              {["What tasks do I have?", "How much did I work this week?", "Log 2 hours to my project yesterday"].map((text) => (
                <button
                  key={text}
                  type="button"
                  className={cn(
                    "w-full text-left bg-muted rounded-lg hover:bg-muted/80 transition-colors",
                    isSidebar ? "px-2 py-1.5" : "px-4 py-3"
                  )}
                  onClick={() => handleExampleClick(text)}
                >
                  &quot;{text}&quot;
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className={cn("bg-destructive/10 text-destructive rounded-md", textSize, padding)}>
            {error.message}
          </div>
        )}

        {messages.map((message, msgIndex) => (
          <div key={`${message.id}-${msgIndex}`} className="space-y-1">
            <div className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[90%] rounded-lg",
                  padding,
                  textSize,
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted prose prose-sm dark:prose-invert prose-p:my-1 prose-headings:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-table:my-1 max-w-none"
                )}
              >
                {message.role === "user" ? (
                  <p className="whitespace-pre-wrap">
                    {message.parts
                      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
                      .map((p) => p.text)
                      .join("") || ""}
                  </p>
                ) : (
                  <>
                    {message.parts?.map((part, idx) => {
                      if (part.type === "text" && part.text) {
                        return (
                          <ReactMarkdown
                            key={idx}
                            remarkPlugins={[remarkGfm]}
                            components={{
                              table: ({ children }) => (
                                <table className="border-collapse w-full text-xs my-1">{children}</table>
                              ),
                              thead: ({ children }) => (
                                <thead className="bg-muted/50">{children}</thead>
                              ),
                              th: ({ children }) => (
                                <th className="border border-border px-2 py-0.5 text-left font-medium text-xs">{children}</th>
                              ),
                              td: ({ children }) => (
                                <td className="border border-border px-2 py-0.5 text-xs">{children}</td>
                              ),
                              code: ({ children }) => (
                                <code className="bg-background/50 px-1 py-0.5 rounded text-xs font-mono">{children}</code>
                              ),
                              ul: ({ children }) => (
                                <ul className="list-disc pl-3 space-y-0">{children}</ul>
                              ),
                              ol: ({ children }) => (
                                <ol className="list-decimal pl-3 space-y-0">{children}</ol>
                              ),
                              p: ({ children }) => (
                                <p className={cn("my-0.5", textSize)}>{children}</p>
                              ),
                              strong: ({ children }) => (
                                <strong className="font-semibold">{children}</strong>
                              ),
                            }}
                          >
                            {part.text}
                          </ReactMarkdown>
                        );
                      }

                      if (part.type.startsWith("tool-")) {
                        const toolName = part.type.replace("tool-", "");
                        const toolPart = part as {
                          type: string;
                          toolCallId?: string;
                          state: "partial-call" | "call" | "input-available" | "output-available" | "result";
                          input?: Record<string, unknown>;
                          output?: unknown;
                        };

                        const toolCallId = toolPart.toolCallId || `${message.id}-${idx}`;
                        const isWriteTool = WRITE_TOOLS.includes(toolName);
                        const approvalState = pendingApprovals[toolCallId];
                        const hasResult = toolPart.state === "output-available" || toolPart.state === "result";
                        const needsApproval = isWriteTool && !hasResult && !approvalState && (toolPart.state === "call" || toolPart.state === "input-available");

                        // Approval UI
                        if (needsApproval) {
                          return (
                            <div key={idx} className={cn("my-1 border-2 border-amber-500/50 rounded-lg bg-amber-500/10", padding)}>
                              <div className="flex items-center gap-1.5 mb-1">
                                <AlertCircle className={cn(iconSize, "text-amber-500 shrink-0")} />
                                <span className={cn("font-medium", textSize)}>{formatToolName(toolName)}</span>
                              </div>
                              {toolPart.input && Object.keys(toolPart.input).length > 0 && (
                                <div className={cn("text-foreground mb-2 pl-4", textSize)}>
                                  {getToolDescription(toolName, toolPart.input)}
                                </div>
                              )}
                              <div className="flex gap-1.5 pl-4">
                                <Button
                                  size="sm"
                                  variant="default"
                                  className={isSidebar ? "h-6 text-xs px-2" : "h-7 text-xs"}
                                  onClick={() => handleToolApproval(toolCallId, toolName, toolPart.input || {})}
                                >
                                  <Check className="h-3 w-3 mr-1" />
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className={isSidebar ? "h-6 text-xs px-2" : "h-7 text-xs"}
                                  onClick={() => handleToolRejection(toolCallId, toolName)}
                                >
                                  <X className="h-3 w-3 mr-1" />
                                  Reject
                                </Button>
                              </div>
                            </div>
                          );
                        }

                        // Executing state
                        if (approvalState === "executing") {
                          return (
                            <div key={idx} className={cn("my-1 border rounded bg-card/50", textSize, isSidebar ? "px-2 py-1" : "px-2 py-1.5")}>
                              <div className="flex items-center gap-1">
                                <Loader2 className={cn(iconSize, "animate-spin text-blue-500 shrink-0")} />
                                <span className="text-muted-foreground">Executing {formatToolName(toolName)}...</span>
                              </div>
                            </div>
                          );
                        }

                        // Rejected state
                        if (approvalState === "rejected") {
                          return (
                            <div key={idx} className={cn("my-1 border rounded bg-red-500/10", textSize, isSidebar ? "px-2 py-1" : "px-2 py-1.5")}>
                              <div className="flex items-center gap-1">
                                <X className={cn(iconSize, "text-red-500 shrink-0")} />
                                <span className="text-muted-foreground">{formatToolName(toolName)} - Rejected</span>
                              </div>
                            </div>
                          );
                        }

                        // Completed state
                        const isComplete = hasResult || approvalState === "approved";
                        const outputObj = toolPart.output as Record<string, unknown> | undefined;
                        const isFailed = outputObj?.success === false || outputObj?.error;
                        const errorMessage = isFailed && outputObj?.error ? String(outputObj.error) : null;

                        return (
                          <div
                            key={idx}
                            className={cn(
                              "my-1 border rounded",
                              textSize,
                              isSidebar ? "px-2 py-1" : "px-2 py-1.5",
                              isFailed ? "bg-red-500/10" : "bg-card/50"
                            )}
                          >
                            <div className="flex items-center gap-1">
                              {isComplete ? (
                                isFailed ? (
                                  <X className={cn(iconSize, "text-red-500 shrink-0")} />
                                ) : (
                                  <Check className={cn(iconSize, "text-green-600 shrink-0")} />
                                )
                              ) : (
                                <Loader2 className={cn(iconSize, "animate-spin text-muted-foreground shrink-0")} />
                              )}
                              <span className="text-muted-foreground">
                                {formatToolName(toolName)}
                                {toolPart.input && Object.keys(toolPart.input).length > 0 && (
                                  <span className="ml-1 opacity-70">({formatArgs(toolPart.input)})</span>
                                )}
                                {errorMessage && <span className="ml-1 text-red-500">- {errorMessage}</span>}
                              </span>
                            </div>
                          </div>
                        );
                      }

                      return null;
                    })}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}

        {isLoading && messages.length > 0 && messages[messages.length - 1]?.role === "user" && (
          <div className="flex justify-start">
            <div className={cn("bg-muted rounded-lg", padding)}>
              <Loader2 className={cn(iconSize, "animate-spin text-muted-foreground")} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className={cn(
          "flex gap-2 border-t bg-background",
          isSidebar ? "p-2" : "fixed bottom-16 left-0 right-0 md:relative md:bottom-auto p-4 md:p-0 md:pt-4 z-40"
        )}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder="Type a message..."
          disabled={isLoading}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            textSize,
            isSidebar ? "min-h-[32px] max-h-[80px] px-2 py-1.5" : "min-h-[40px] max-h-[120px] px-3 py-2"
          )}
        />
        {isLoading ? (
          <Button type="button" size="icon" variant="destructive" onClick={stop} className={isSidebar ? "h-8 w-8" : ""}>
            <Square className={iconSize} />
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={!input.trim()} className={isSidebar ? "h-8 w-8" : ""}>
            <Send className={iconSize} />
          </Button>
        )}
      </form>
    </div>
  );
}
