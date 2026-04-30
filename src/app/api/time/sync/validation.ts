type ValidationSuccess = { ok: true; value: Date };
type ValidationFailure = { ok: false; message: string; permanent: true };

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

function parseIsoDate(value: string): Date | null {
  if (!ISO_TIMESTAMP_PATTERN.test(value)) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseStartedAtForSync(input: {
  payloadStartedAt?: unknown;
  actionCreatedAt: string;
}): ValidationSuccess | ValidationFailure {
  if (input.payloadStartedAt != null) {
    if (typeof input.payloadStartedAt !== "string") {
      return { ok: false, message: "Invalid startedAt", permanent: true };
    }

    const parsed = parseIsoDate(input.payloadStartedAt);
    if (!parsed) {
      return { ok: false, message: "Invalid startedAt", permanent: true };
    }
    return { ok: true, value: parsed };
  }

  const fallback = parseIsoDate(input.actionCreatedAt);
  if (!fallback) {
    return { ok: false, message: "Invalid createdAt", permanent: true };
  }

  return { ok: true, value: fallback };
}

export function resolveStoppedAtForSync(input: {
  payloadStoppedAt?: unknown;
  activeTimerStartedAt: Date;
  now?: Date;
}): ValidationSuccess | ValidationFailure {
  const resolved = (() => {
    if (input.payloadStoppedAt == null) {
      return input.now ?? new Date();
    }

    if (typeof input.payloadStoppedAt !== "string") {
      return null;
    }

    return parseIsoDate(input.payloadStoppedAt);
  })();

  if (!resolved) {
    return { ok: false, message: "Invalid stoppedAt", permanent: true };
  }

  if (resolved.getTime() < input.activeTimerStartedAt.getTime()) {
    return { ok: false, message: "Invalid stoppedAt", permanent: true };
  }

  return { ok: true, value: resolved };
}
