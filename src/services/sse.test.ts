import assert from "node:assert/strict";
import test from "node:test";
import { assertCompleteSSE, extractSSEEvents, TruncatedSSEError } from "./sse";

test("extractSSEEvents retains a fragmented final event", () => {
  const first = extractSSEEvents('data: {"one":1}\n\ndata: {"two"');
  assert.deepEqual(first.events, ['{"one":1}']);
  assert.equal(first.remainder, 'data: {"two"');

  const second = extractSSEEvents(`${first.remainder}:2}\r\n\r\n`);
  assert.deepEqual(second.events, ['{"two":2}']);
  assert.equal(second.remainder, "");
});

test("extractSSEEvents joins multi-line data payloads", () => {
  assert.deepEqual(
    extractSSEEvents("event: message\ndata: hello\ndata: world\n\n").events,
    ["hello\nworld"],
  );
});

test("extractSSEEvents flushes a final event without a blank line", () => {
  assert.deepEqual(extractSSEEvents("data: [DONE]", true), {
    events: ["[DONE]"],
    remainder: "",
  });
});

test("a stream without a provider DONE event is contractually truncated", () => {
  assert.doesNotThrow(() => assertCompleteSSE(true, ""));
  assert.throws(
    () => assertCompleteSSE(false, ""),
    (error: unknown) => error instanceof TruncatedSSEError,
  );
  assert.throws(
    () => assertCompleteSSE(true, 'data: {"partial"'),
    (error: unknown) => error instanceof TruncatedSSEError,
  );
});

test("every byte boundary preserves fragmented CRLF events in order", () => {
  const stream =
    'data: {"choices":[{"delta":{"content":"こ"}}]}\r\n\r\n' +
    'data: {"choices":[{"delta":{"audio":{"transcript":"ん"}}}]}\n\n' +
    "data: [DONE]\r\n\r\n";
  let remainder = "";
  const events: string[] = [];

  for (const character of stream) {
    const next = extractSSEEvents(`${remainder}${character}`);
    events.push(...next.events);
    remainder = next.remainder;
  }
  const final = extractSSEEvents(remainder, true);
  events.push(...final.events);

  assert.deepEqual(events, [
    '{"choices":[{"delta":{"content":"こ"}}]}',
    '{"choices":[{"delta":{"audio":{"transcript":"ん"}}}]}',
    "[DONE]",
  ]);
  assert.equal(final.remainder, "");
  assert.doesNotThrow(() => assertCompleteSSE(events.at(-1) === "[DONE]", ""));
});
