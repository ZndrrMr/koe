export type ResponseRun = {
  turnId: string;
  token: number;
  signal: AbortSignal;
};

/** Owns exactly one response generation/playback run at a time. */
export class ResponseRunController {
  private current?: ResponseRun & { controller: AbortController };
  private generation = 0;

  start(turnId: string): ResponseRun {
    this.interrupt();
    const controller = new AbortController();
    const run = {
      turnId,
      token: ++this.generation,
      signal: controller.signal,
      controller,
    };
    this.current = run;
    return run;
  }

  interrupt(): string | undefined {
    const run = this.current;
    if (!run) return undefined;
    this.current = undefined;
    run.controller.abort();
    return run.turnId;
  }

  complete(turnId: string): boolean {
    if (this.current?.turnId !== turnId) return false;
    this.current = undefined;
    return true;
  }

  isCurrent(turnId: string): boolean {
    return this.current?.turnId === turnId;
  }

  isLatest(token: number): boolean {
    return token === this.generation;
  }

  hasActiveRun(): boolean {
    return Boolean(this.current);
  }
}
