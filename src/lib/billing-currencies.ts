/** Default when adding a task to billing (Czech crowns). */
export const DEFAULT_BILLING_CURRENCY = "CZK";

/**
 * Curated list for the picker — CZK first, then common EU / freelance currencies.
 */
export const BILLING_CURRENCY_PRESETS: ReadonlyArray<{
  code: string;
  label: string;
}> = [
  { code: "CZK", label: "CZK — Czech koruna" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "USD", label: "USD — US dollar" },
  { code: "GBP", label: "GBP — British pound" },
  { code: "PLN", label: "PLN — Polish złoty" },
  { code: "CHF", label: "CHF — Swiss franc" },
  { code: "SEK", label: "SEK — Swedish krona" },
  { code: "NOK", label: "NOK — Norwegian krone" },
  { code: "DKK", label: "DKK — Danish krone" },
  { code: "HUF", label: "HUF — Hungarian forint" },
];

const PRESET_CODES = new Set(BILLING_CURRENCY_PRESETS.map((p) => p.code));

/** Options for a <select>, including the current code if it is not in the preset list. */
export function billingCurrencySelectOptions(
  currentCode?: string | null
): { code: string; label: string }[] {
  const rows = BILLING_CURRENCY_PRESETS.map((p) => ({
    code: p.code,
    label: p.label,
  }));
  const c = currentCode?.trim();
  const u = c ? c.toUpperCase() : "";
  if (u && !PRESET_CODES.has(u)) {
    rows.push({ code: u, label: `${u} — other` });
  }
  return rows;
}
