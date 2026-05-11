"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

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
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
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
