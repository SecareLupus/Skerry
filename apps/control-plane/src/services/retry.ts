/** Errors thrown through this symbol advertise a minimum backoff before retrying. */
export const RETRY_AFTER_MS = Symbol.for("skerry.retry-after-ms");

export async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        const hint = (error as { [RETRY_AFTER_MS]?: number })?.[RETRY_AFTER_MS];
        const delay = Math.max(hint ?? 0, 200 * (attempt + 1));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
