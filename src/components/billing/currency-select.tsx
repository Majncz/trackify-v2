"use client";

import { DEFAULT_BILLING_CURRENCY, billingCurrencySelectOptions } from "@/lib/billing-currencies";
import { cn } from "@/lib/utils";

type CurrencySelectProps = {
  id?: string;
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  className?: string;
};

const selectClassName = cn(
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
);

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

  return (
    <select
      id={id}
      className={cn(selectClassName, className)}
      value={normalized}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.code} value={o.code}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
