"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DisplayNameForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [saved, setSaved] = useState(initialName);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);

  const dirty = name.trim() !== saved.trim();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not save name");
      }
      setSaved(data.displayName ?? name.trim());
      setName(data.displayName ?? name.trim());
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not save name");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="display-name">Display name</Label>
        <Input
          id="display-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setStatus("idle");
          }}
          maxLength={40}
          placeholder="How others see you"
        />
        <p className="text-xs text-muted-foreground">
          Shown when you are tracking a task.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!dirty || status === "saving" || !name.trim()}>
          {status === "saving" ? "Saving..." : "Save name"}
        </Button>
        {status === "saved" && (
          <p className="text-sm text-muted-foreground">Saved</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </form>
  );
}
