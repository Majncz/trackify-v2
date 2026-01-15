"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Conversation {
  id: string;
  title: string | null;
  updatedAt: Date;
}

interface ChatTabBarProps {
  currentConversationId: string | null;
  onConversationChange: (id: string | null) => void;
  refreshTrigger?: number;
}

export function ChatTabBar({ currentConversationId, onConversationChange, refreshTrigger }: ChatTabBarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const conversationsRef = useRef<Conversation[]>([]);

  async function fetchConversations() {
    try {
      const res = await fetch("/api/conversations");
      if (res.ok) {
        const data = await res.json();
        conversationsRef.current = data;
        setConversations(data);
      }
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchConversations();
  }, []);

  // Refresh when triggered externally (e.g., after message sent)
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      fetchConversations();
    }
  }, [refreshTrigger]);

  // Refresh when current conversation changes (e.g., new conversation created)
  useEffect(() => {
    if (currentConversationId && !conversationsRef.current.find(c => c.id === currentConversationId)) {
      fetchConversations();
    }
  }, [currentConversationId]);

  // Scroll to end so the + button is visible
  useEffect(() => {
    if (scrollRef.current && !loading) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [conversations, loading]);

  async function handleNewChat() {
    try {
      const res = await fetch("/api/conversations", { method: "POST" });
      if (res.ok) {
        const newConv = await res.json();
        setConversations((prev) => {
          const updated = [...prev, newConv];
          conversationsRef.current = updated;
          return updated;
        });
        onConversationChange(newConv.id);
      }
    } catch (error) {
      console.error("Failed to create conversation:", error);
    }
  }

  function truncateTitle(title: string | null): string {
    if (!title) return "New chat";
    const words = title.split(" ");
    if (words.length > 3) {
      return words.slice(0, 3).join(" ") + "...";
    }
    return title;
  }

  return (
    <div className="border-b bg-background mb-4">
      <div ref={scrollRef} className="flex items-center overflow-x-auto px-3 py-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {loading ? (
          <div className="px-4 py-2 text-sm text-muted-foreground">Loading...</div>
        ) : (
          <>
            {conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => onConversationChange(conv.id)}
                className={cn(
                  "group flex items-center gap-1 px-2 py-1 rounded-md text-sm whitespace-nowrap transition-colors cursor-pointer",
                  currentConversationId === conv.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                )}
              >
                <span>{truncateTitle(conv.title)}</span>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNewChat}
              className="shrink-0 h-8 w-8 p-0"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
