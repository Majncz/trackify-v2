/**
 * Seeded quick-picks created once per user (isBuiltIn).
 */
export const AI_SUBSCRIPTION_BUILTIN_DEFS: {
  name: string;
  providerKey: string;
  sortOrder: number;
}[] = [
  { name: "Cursor Pro", providerKey: "cursor", sortOrder: 0 },
  { name: "ChatGPT Plus", providerKey: "openai", sortOrder: 1 },
  { name: "GitHub Copilot", providerKey: "github_copilot", sortOrder: 2 },
  { name: "Claude Pro", providerKey: "anthropic", sortOrder: 3 },
  { name: "Perplexity Pro", providerKey: "perplexity", sortOrder: 4 },
  { name: "Midjourney", providerKey: "midjourney", sortOrder: 5 },
  { name: "JetBrains AI", providerKey: "jetbrains", sortOrder: 6 },
  { name: "Other / custom", providerKey: "other", sortOrder: 99 },
];
