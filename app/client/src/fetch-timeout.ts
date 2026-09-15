/**
 * A fetch that cannot hold a screen in its loading state forever.
 *
 * Aborting is best-effort: some test doubles and some transports ignore the
 * signal, so the deadline also races the request and settles independently.
 *
 * WHATEVER PATH FIRES, THE REJECTION READS IN WORDS. A caller that surfaces
 * `error.message` (the watchlist rail does exactly this) must never show the
 * transport's raw "signal is aborted without reason": that sentence tells a
 * reader nothing and looks like a crash. Both the abort and the independent
 * deadline reject with the same actionable message instead.
 */
export function timedOutMessage(timeoutMs: number): string {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return `This request took longer than ${seconds} second${seconds === 1 ? '' : 's'} and was stopped before it answered, so the data source may be busy — try again in a moment`;
}

/** True for the AbortError a signal raises, whatever the transport wraps it in. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const message = timedOutMessage(timeoutMs);
  let timedOut = false;

  // The internal controller replaces init.signal on the fetch, so a caller's own
  // signal would never reach the transport unless we forward its abort here.
  const callerSignal = init.signal ?? undefined;
  const forwardAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', forwardAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let deadline: ReturnType<typeof setTimeout> | undefined;

  try {
    const raced = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    const request = fetch(input, { ...init, signal: controller.signal }).catch((error: unknown) => {
      // Translate only the abort our own timer caused into the deadline's
      // sentence. A transport error that merely landed after the timer fired
      // keeps its real message, and a caller-driven abort propagates unchanged.
      if (timedOut && isAbortError(error)) throw new Error(message);
      throw error;
    });
    return await Promise.race([request, raced]);
  } finally {
    clearTimeout(timer);
    if (deadline) clearTimeout(deadline);
    if (callerSignal) callerSignal.removeEventListener('abort', forwardAbort);
  }
}
