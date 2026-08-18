export function displayNameFromEmail(email: string) {
  const local = email.split("@")[0] ?? email;
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function personName(user: { displayName?: string | null; email: string }) {
  const named = user.displayName?.trim();
  return named || displayNameFromEmail(user.email);
}
