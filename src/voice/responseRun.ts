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

  /** Invalidates every token, even when the active request already completed. */
  invalidate(): string | undefined {
    const turnId = this.interrupt();
    this.generation += 1;
    return turnId;
  }

  complete(turnId: string, token?: number): boolean {
    if (
      this.current?.turnId !== turnId ||
      (token !== undefined && this.current.token !== token)
    )
      return false;
    this.current = undefined;
    return true;
  }

  isCurrent(turnId: string, token?: number): boolean {
    return (
      this.current?.turnId === turnId &&
      (token === undefined || this.current.token === token)
    );
  }

  isLatest(token: number): boolean {
    return token === this.generation;
  }

  hasActiveRun(): boolean {
    return Boolean(this.current);
  }
}
