export type VoiceTraceContext = {
  sessionId?: string;
  turnId?: string;
  responseRunId?: string;
};

export type TelemetryScalar = string | number | boolean | null | undefined;
export type TelemetryFields = Record<string, TelemetryScalar>;
export type TelemetryLevel = "info" | "warn" | "error";

const PRIVATE_FIELD =
  /(?:^|_)(?:authorization|secret|token|body|content|text|transcript|audio(?:base64|content|data)|speech)(?:$|_)/i;

function safeFields(
  fields: TelemetryFields,
): Record<string, Exclude<TelemetryScalar, undefined>> {
  const safe: Record<string, Exclude<TelemetryScalar, undefined>> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || PRIVATE_FIELD.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}

export function serializeVoiceEvent(
  event: string,
  trace: VoiceTraceContext = {},
  fields: TelemetryFields = {},
  level: TelemetryLevel = "info",
): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    component: "koe-app",
    event,
    ...trace,
    ...safeFields(fields),
  });
}

/** Emits only structured metadata. Callers pass counts and classifications,
 * never utterances, audio payloads, provider bodies, credentials, or tokens. */
export function voiceEvent(
  event: string,
  trace: VoiceTraceContext = {},
  fields: TelemetryFields = {},
  level: TelemetryLevel = "info",
): void {
  const line = serializeVoiceEvent(event, trace, fields, level);
  // The structured level remains queryable without routing expected provider,
  // transcript, or cancellation outcomes through React Native's red-box UI.
  console.log(line);
}

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
