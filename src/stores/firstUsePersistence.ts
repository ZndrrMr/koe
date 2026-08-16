export const FIRST_USE_STORAGE_KEY = "koe-first-use";
export const LEGACY_SETTINGS_STORAGE_KEY = "koe-voice-settings";

export type SyncStringStorage = {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
};

/**
 * Reads the shipped settings payload once so onboarding state survives the
 * upgrade. The first write keeps only first-use state under the new key and
 * deletes the obsolete settings payload.
 */
export function createFirstUseStorage(
  storage: SyncStringStorage,
): SyncStringStorage {
  return {
    getItem: (name) => {
      const current = storage.getItem(name);
      if (current !== null) {
        storage.removeItem(LEGACY_SETTINGS_STORAGE_KEY);
        return current;
      }
      return storage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
    },
    setItem: (name, value) => {
      storage.setItem(name, value);
      storage.removeItem(LEGACY_SETTINGS_STORAGE_KEY);
    },
    removeItem: (name) => {
      storage.removeItem(name);
      storage.removeItem(LEGACY_SETTINGS_STORAGE_KEY);
    },
  };
}

export function migrateFirstUseState(persisted: unknown) {
  return {
    onboardingDone: Boolean(
      (persisted as { onboardingDone?: unknown } | undefined)?.onboardingDone,
    ),
  };
}
