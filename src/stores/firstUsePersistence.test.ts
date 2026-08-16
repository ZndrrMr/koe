import assert from "node:assert/strict";
import test from "node:test";

import {
  createFirstUseStorage,
  FIRST_USE_STORAGE_KEY,
  LEGACY_SETTINGS_STORAGE_KEY,
  migrateFirstUseState,
} from "./firstUsePersistence";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    storage: {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => {
        values.set(name, value);
      },
      removeItem: (name: string) => {
        values.delete(name);
      },
    },
  };
}

test("legacy settings preserve only onboarding before the old key is deleted", () => {
  const legacyPayload = JSON.stringify({
    state: {
      onboardingDone: true,
      goal: "travel",
      responseLevel: "full-speed",
      voice: "removed-voice",
      correctionStyle: "detailed",
    },
    version: 1,
  });
  const memory = memoryStorage({
    [LEGACY_SETTINGS_STORAGE_KEY]: legacyPayload,
  });
  const storage = createFirstUseStorage(memory.storage);

  assert.equal(storage.getItem(FIRST_USE_STORAGE_KEY), legacyPayload);
  assert.deepEqual(migrateFirstUseState(JSON.parse(legacyPayload).state), {
    onboardingDone: true,
  });

  const migrated = JSON.stringify({
    state: { onboardingDone: true },
    version: 3,
  });
  storage.setItem(FIRST_USE_STORAGE_KEY, migrated);

  assert.equal(memory.values.get(FIRST_USE_STORAGE_KEY), migrated);
  assert.equal(memory.values.has(LEGACY_SETTINGS_STORAGE_KEY), false);
  assert.doesNotMatch(migrated, /goal|responseLevel|voice|correctionStyle/);
});

test("an existing first-use payload also clears any leftover settings key", () => {
  const current = JSON.stringify({
    state: { onboardingDone: false },
    version: 3,
  });
  const memory = memoryStorage({
    [FIRST_USE_STORAGE_KEY]: current,
    [LEGACY_SETTINGS_STORAGE_KEY]: "stale",
  });

  const storage = createFirstUseStorage(memory.storage);
  assert.equal(storage.getItem(FIRST_USE_STORAGE_KEY), current);
  assert.equal(memory.values.has(LEGACY_SETTINGS_STORAGE_KEY), false);
});
