export type WorkerTraceContext = {
  sessionId?: string;
  turnId?: string;
  responseRunId: string;
};

type Scalar = string | number | boolean | null | undefined;

const PRIVATE_FIELD =
  /(?:^|_)(?:authorization|secret|token|body|content|text|transcript|audio(?:base64|content|data)|speech)(?:$|_)/i;

function cleanIdentifier(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

export function workerTrace(headers: Headers): WorkerTraceContext {
  return {
    sessionId: cleanIdentifier(headers.get("X-Koe-Session-Id") ?? undefined),
    turnId: cleanIdentifier(headers.get("X-Koe-Turn-Id") ?? undefined),
    responseRunId:
      cleanIdentifier(headers.get("X-Koe-Response-Run-Id") ?? undefined) ??
      crypto.randomUUID(),
  };
}

export function serializeWorkerEvent(
  event: string,
  trace: WorkerTraceContext,
  fields: Record<string, Scalar> = {},
  level: "info" | "warn" | "error" = "info",
): string {
  const safe: Record<string, Exclude<Scalar, undefined>> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || PRIVATE_FIELD.test(key)) continue;
    safe[key] = value;
  }
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    component: "koe-worker",
    event,
    ...trace,
    ...safe,
  });
}

export function workerEvent(
  event: string,
  trace: WorkerTraceContext,
  fields: Record<string, Scalar> = {},
  level: "info" | "warn" | "error" = "info",
): void {
  const line = serializeWorkerEvent(event, trace, fields, level);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function providerRequestId(response: Response): string | undefined {
  for (const name of [
    "x-request-id",
    "request-id",
    "inworld-request-id",
    "cf-ray",
  ]) {
    const value = cleanIdentifier(response.headers.get(name) ?? undefined);
    if (value) return value;
  }
  return undefined;
}
