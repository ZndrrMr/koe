import { config } from "@/utils/config";
import { getDeviceId } from "@/utils/device";
import { log } from "@/utils/log";
import { fetch as expoFetch } from "expo/fetch";

export class WorkerError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function workerUrl(path: string): string {
  const base = config.workerUrl?.replace(/\/+$/, "") ?? "";
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function authHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    "X-Device-Id": getDeviceId(),
    ...(extra ?? {}),
  };
}

export async function postJson<T>(
  path: string,
  body: unknown,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(workerUrl(path), {
    ...init,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    log.info("Worker request returned a non-success response", {
      path,
      status: res.status,
    });
    throw new WorkerError(
      res.statusText || "Worker request failed",
      res.status,
    );
  }
  return (await res.json()) as T;
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(workerUrl(path), { headers: authHeaders() });
  if (!res.ok) {
    throw new WorkerError(
      res.statusText || "Worker request failed",
      res.status,
    );
  }
  return (await res.json()) as T;
}

export async function postStream(
  path: string,
  body: unknown,
  init?: RequestInit,
): ReturnType<typeof expoFetch> {
  // React Native's global fetch returns a null response.body on iOS. Expo's
  // native fetch exposes the incremental ReadableStream required for SSE.
  const res = await expoFetch(workerUrl(path), {
    ...init,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new WorkerError(
      res.statusText || "Worker request failed",
      res.status,
    );
  }
  return res;
}
