import { config } from '@/utils/config';
import { getDeviceId } from '@/utils/device';
import { log } from '@/utils/log';

export class WorkerError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function workerUrl(path: string): string {
  const base = config.workerUrl?.replace(/\/+$/, '') ?? '';
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'X-Device-Id': getDeviceId(),
    ...(extra ?? {}),
  };
}

export async function postJson<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(workerUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
    ...(init ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    log.error(`POST ${path} -> ${res.status}: ${text}`);
    throw new WorkerError(text || res.statusText, res.status);
  }
  return (await res.json()) as T;
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(workerUrl(path), { headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new WorkerError(text || res.statusText, res.status);
  }
  return (await res.json()) as T;
}

export async function postStream(path: string, body: unknown): Promise<Response> {
  const res = await fetch(workerUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new WorkerError(text || res.statusText, res.status);
  }
  return res;
}
