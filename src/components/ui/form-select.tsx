"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const SelectSingleScopeContext = React.createContext<{
  activeId: string | null;
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>;
} | null>(null);

/** When wrapped around a form, only one Radix Select dropdown stays open at a time. */
export function SelectSingleScope({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  return (
    <SelectSingleScopeContext.Provider value={{ activeId, setActiveId }}>
      {children}
    </SelectSingleScopeContext.Provider>
  );
}

export function useScopedSelectOpen(instanceId: string) {
  const ctx = React.useContext(SelectSingleScopeContext);
  if (!ctx) return undefined;
  const { activeId, setActiveId } = ctx;
  return {
    open: activeId === instanceId,
    onOpenChange: (next: boolean) => {
      setActiveId((prev) => {
        if (next) return instanceId;
        return prev === instanceId ? null : prev;
      });
    },
  } as const;
}

export const FORM_SELECT_NONE = "__form_select_none__";

export type FormSelectOption = { value: string; label: string };

type FormSelectProps = {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: FormSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Compact toolbar height (e.g. billing filters). */
  size?: "default" | "sm";
  triggerClassName?: string;
  "aria-label"?: string;
};

/** Shared layout for all popper select menus (matches currency select). */
export const formSelectContentProps = {
  position: "popper" as const,
  sideOffset: 6,
  align: "start" as const,
};

export function FormSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  size = "default",
  triggerClassName,
  "aria-label": ariaLabel,
}: FormSelectProps) {
  const instanceId = React.useId();
  const scoped = useScopedSelectOpen(instanceId);
  return (
    <Select
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      {...(scoped
        ? { open: scoped.open, onOpenChange: scoped.onOpenChange }
        : {})}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          size === "sm" && "h-8 py-0.5 text-xs px-2",
          className,
          triggerClassName,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent {...formSelectContentProps}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
