"use client";

import * as React from "react";
import {
  DEFAULT_BILLING_CURRENCY,
  billingCurrencySelectOptions,
} from "@/lib/billing-currencies";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formSelectContentProps,
  useScopedSelectOpen,
} from "@/components/ui/form-select";

type CurrencySelectProps = {
  id?: string;
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  className?: string;
};

export function CurrencySelect({
  id,
  value,
  onChange,
  disabled,
  className,
}: CurrencySelectProps) {
  const normalized =
    value?.trim().length > 0
      ? value.trim().toUpperCase()
      : DEFAULT_BILLING_CURRENCY;
  const options = billingCurrencySelectOptions(normalized);
  const instanceId = React.useId();
  const scoped = useScopedSelectOpen(instanceId);

  return (
    <Select
      value={normalized}
      onValueChange={onChange}
      disabled={disabled}
      {...(scoped
        ? { open: scoped.open, onOpenChange: scoped.onOpenChange }
        : {})}
    >
      <SelectTrigger
        id={id}
        className={cn("w-full min-w-0", className)}
        aria-label={id ? undefined : "Currency"}
      >
        <SelectValue placeholder="Choose currency" />
      </SelectTrigger>
      <SelectContent {...formSelectContentProps}>
        {options.map((o) => (
          <SelectItem key={o.code} value={o.code}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
