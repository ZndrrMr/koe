export function extractSSEEvents(buffer: string, flush = false): {
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
