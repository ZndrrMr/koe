const PREFIX = '[Koe]';

export const log = {
  info: (...args: unknown[]) => console.log(PREFIX, ...args),
  warn: (...args: unknown[]) => console.warn(PREFIX, ...args),
  error: (...args: unknown[]) => console.error(PREFIX, ...args),
};

export async function safe<T>(fn: () => Promise<T>, tag: string): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    log.error(`${tag} failed:`, e);
    return null;
  }
}
