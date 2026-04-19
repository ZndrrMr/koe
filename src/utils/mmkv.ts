import { createMMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

export const kv = createMMKV({ id: 'koe-app' });

export const mmkvStorage: StateStorage = {
  setItem: (name, value) => kv.set(name, value),
  getItem: (name) => kv.getString(name) ?? null,
  removeItem: (name) => { kv.remove(name); },
};
