export function extractSSEEvents(
  buffer: string,
  flush = false,
): {
  events: string[];
  remainder: string;
} {
  let normalized = buffer.replace(/\r\n/g, "\n");
  if (flush && normalized.trim()) normalized += "\n\n";
  const blocks = normalized.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const events = blocks
    .map((block) =>
      block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n"),
    )
    .filter(Boolean);
  return { events, remainder };
}

export class TruncatedSSEError extends Error {
  constructor(message = "Provider SSE ended before its [DONE] event") {
    super(message);
    this.name = "TruncatedSSEError";
  }
}

export function assertCompleteSSE(sawDone: boolean, remainder: string): void {
  if (!sawDone || remainder.trim()) throw new TruncatedSSEError();
}
