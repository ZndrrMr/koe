import { createMMKV } from 'react-native-mmkv';
import { v4 as uuidv4 } from 'uuid';

const storage = createMMKV({ id: 'koe-device' });
const KEY = 'deviceId';

export function getDeviceId(): string {
  let id = storage.getString(KEY);
  if (!id) {
    id = uuidv4();
    storage.set(KEY, id);
  }
  return id;
}
