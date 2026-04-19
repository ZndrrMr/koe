import type { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  extra: {
    ...(config.extra ?? {}),
    workerUrl: process.env.EXPO_PUBLIC_WORKER_URL ?? null,
    sentryDsn: process.env.SENTRY_DSN ?? null,
  },
});
