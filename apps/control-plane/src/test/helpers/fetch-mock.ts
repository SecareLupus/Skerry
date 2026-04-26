/**
 * Run `body` with `globalThis.fetch` replaced by `mock`. Always restores the
 * original fetch — even if `body` throws — preventing the mock from leaking
 * into subsequent tests. Always prefer this over the manual
 * `originalFetch = globalThis.fetch; ...; globalThis.fetch = originalFetch`
 * pattern, which is fragile if a mistake is made between the override and
 * the surrounding try/finally.
 */
export async function withMockedFetch<T>(
  mock: typeof globalThis.fetch,
  body: () => Promise<T>
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await body();
  } finally {
    globalThis.fetch = original;
  }
}
