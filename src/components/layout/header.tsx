"use client";

import Link from "next/link";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSocket } from "@/hooks/use-socket";
import { cn } from "@/lib/utils";

export function Header() {
  const { isConnected } = useSocket();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
      <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg flex items-center gap-2">
          Trackify
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full transition-colors relative",
              isConnected 
                ? "bg-green-500 animate-pulse-dot shadow-[0_0_6px_rgba(34,197,94,0.6)]" 
                : "bg-red-500 animate-pulse-dot-slow shadow-[0_0_6px_rgba(239,68,68,0.4)]"
            )}
            title={isConnected ? "Connected" : "Disconnected"}
          />
        </Link>
        <Link href="/settings" className="hidden md:block">
          <Button variant="ghost" size="icon">
            <Settings className="h-5 w-5" />
            <span className="sr-only">Settings</span>
          </Button>
        </Link>
      </div>
    </header>
  );
}
