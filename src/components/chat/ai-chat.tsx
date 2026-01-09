"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { ChatInterface } from "./chat-interface";

export function AIChat() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  
  // Hide sidebar on /chat page since full chat is already visible
  if (pathname === "/chat") {
    return null;
  }

  return (
    <div className="hidden md:block">
      {/* Toggle Button */}
      <Button
        variant="outline"
        size="icon"
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full shadow-lg"
      >
        {isOpen ? (
          <PanelRightClose className="h-5 w-5" />
        ) : (
          <PanelRightOpen className="h-5 w-5" />
        )}
        <span className="sr-only">
          {isOpen ? "Close AI Assistant" : "Open AI Assistant"}
        </span>
      </Button>

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-14 right-0 h-[calc(100vh-3.5rem)] bg-background border-l shadow-lg transition-transform duration-300 z-40",
          "w-96",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <ChatInterface
          variant="sidebar"
          showTabBar={true}
          header={(
            <div className="flex items-center justify-between px-4 py-3">
              <span className="font-medium">AI Assistant</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
              >
                <PanelRightClose className="h-5 w-5" />
                <span className="sr-only">Close sidebar</span>
              </Button>
            </div>
          )}
        />
      </aside>
    </div>
  );
}
