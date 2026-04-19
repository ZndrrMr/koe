import Constants from 'expo-constants';

type Extra = {
  workerUrl?: string | null;
  sentryDsn?: string | null;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const config = {
  workerUrl:
    extra.workerUrl ??
    process.env.EXPO_PUBLIC_WORKER_URL ??
    'https://koe-worker.example.workers.dev',
  sentryDsn: extra.sentryDsn ?? process.env.SENTRY_DSN ?? null,
};

export const hasWorker = () =>
  Boolean(config.workerUrl && !config.workerUrl.includes('example.workers.dev'));
