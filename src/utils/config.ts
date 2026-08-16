import Constants from "expo-constants";

type Extra = {
  workerUrl?: string | null;
  sentryDsn?: string | null;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

function configuredString(
  manifestValue: unknown,
  environmentValue: string | undefined,
  fallback: string | null,
): string | null {
  if (typeof manifestValue === "string" && manifestValue.trim()) {
    return manifestValue;
  }
  if (typeof environmentValue === "string" && environmentValue.trim()) {
    return environmentValue;
  }
  return fallback;
}

export const config = {
  // JSON nulls in Expo manifest extras can bridge to a non-string native
  // placeholder. Never let that placeholder shadow a development URL.
  workerUrl: configuredString(
    extra.workerUrl,
    process.env.EXPO_PUBLIC_WORKER_URL,
    "https://koe-worker.example.workers.dev",
  ),
  sentryDsn: configuredString(extra.sentryDsn, process.env.SENTRY_DSN, null),
};

export const hasWorker = () =>
  Boolean(
    config.workerUrl && !config.workerUrl.includes("example.workers.dev"),
  );
