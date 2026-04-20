import { createMMKV } from 'react-native-mmkv';
import { randomUUID } from 'expo-crypto';

const storage = createMMKV({ id: 'koe-device' });
const KEY = 'deviceId';

export function getDeviceId(): string {
  let id = storage.getString(KEY);
  if (!id) {
    id = randomUUID();
    storage.set(KEY, id);
  }
  return id;
}
