import assert from "node:assert/strict";

export interface CapturedEvent<TEvent extends string = string> {
  event: TEvent;
  payload: any;
}

export interface EventCapture<TEvent extends string = string> {
  /** All events received so far, in order. */
  readonly events: ReadonlyArray<CapturedEvent<TEvent>>;
  /** Find the first event matching the predicate, or undefined. */
  find(predicate: (e: CapturedEvent<TEvent>) => boolean): CapturedEvent<TEvent> | undefined;
  /** Assert that at least one event matches and return it. */
  expect(
    matcher: TEvent | ((e: CapturedEvent<TEvent>) => boolean),
    message?: string
  ): CapturedEvent<TEvent>;
  /** Clear all captured events. */
  clear(): void;
}

/**
 * Creates an event capture helper backed by a subscribe-style API.
 *
 * Use this instead of `let lastEvent = ...; sub((e, p) => lastEvent = {e,p})`
 * which silently loses events when multiple fire (e.g. `message.created`
 * followed by `typing.stop` — the test then asserts against the wrong one).
 *
 * Usage:
 *   const capture = captureEvents<ChatEvent>((listener) =>
 *     subscribeToChannelMessages("chn_1", listener)
 *   );
 *   try {
 *     await createMessage(...);
 *     const msg = capture.expect("message.created");
 *     assert.equal(msg.payload.id, ...);
 *   } finally {
 *     capture.unsubscribe();
 *   }
 */
export function captureEvents<TEvent extends string = string>(
  subscribe: (listener: (event: TEvent, payload: any) => void) => () => void
): EventCapture<TEvent> & { unsubscribe(): void } {
  const events: CapturedEvent<TEvent>[] = [];
  const unsubscribe = subscribe((event, payload) => {
    events.push({ event, payload });
  });

  const api: EventCapture<TEvent> & { unsubscribe(): void } = {
    events,
    find(predicate) {
      return events.find(predicate);
    },
    expect(matcher, message) {
      const predicate =
        typeof matcher === "function"
          ? matcher
          : (e: CapturedEvent<TEvent>) => e.event === matcher;
      const match = events.find(predicate);
      assert.ok(
        match,
        message ??
          `Expected event ${String(matcher)} but received: [${events.map((e) => e.event).join(", ")}]`
      );
      return match;
    },
    clear() {
      events.length = 0;
    },
    unsubscribe,
  };
  return api;
}
