import type { ConversationChunk, ConversationResult } from "../services/llm";
import type { PronunciationFeedback } from "../services/pitch";
import type { ChatTurn } from "../stores/useSession";
import type { VoiceLatency, VoiceLifecycle, VoicePhase } from "./lifecycle";
import type { VoiceTraceContext } from "../utils/telemetry";
import { VoiceLatencyTracker, voiceError } from "./lifecycle";
import { ResponseRunController, type ResponseRun } from "./responseRun";
import {
  HANDS_FREE_ENDPOINT,
  endpointDelayMs,
  type EndpointSignal,
} from "./turnTaking";

export type ConversationPhase =
  | "idle"
  | "start"
  | "listening"
  | "endpoint"
  | "finalizing"
  | "understanding"
  | "speaking"
  | "resuming"
  | "recovery"
  | "ending"
  | "ended";

export type ConversationOwnership = {
  audioSession: "none" | "microphone" | "playback";
  microphone: number | null;
  providerRequest: number | null;
  playbackQueue: number | null;
  retry: string | null;
};

export type ConversationEngineState = {
  phase: ConversationPhase;
  handsFreeActive: boolean;
  ownership: ConversationOwnership;
  draftTranscript: string;
  draftAudioUri?: string;
  retryingTurnId: string | null;
  showCoda: boolean;
};

export type ConversationEngineDiagnostics = {
  disposed: boolean;
  listenerCount: number;
  activeResponseRunCount: number;
  activeCaptureCount: number;
  activePlaybackQueueCount: number;
  pendingTimerCount: number;
  pendingEnrichmentCount: number;
};

export type TranscriptInputEvent =
  | {
      type: "interim" | "final";
      text: string;
      confidence: number;
    }
  | { type: "speechStart" }
  | { type: "speechEnd" }
  | { type: "endpoint" }
  | { type: "failure"; error: unknown };

export type SpeechInputHandle = {
  stop: () => Promise<{
    fullText: string;
    durationMs: number;
    audioUri: string;
  }>;
  cancel: () => Promise<void>;
};

export type PlaybackQueue = {
  enqueue: (
    audioBase64: string,
    sampleRate: number,
    channels: number,
  ) => Promise<void>;
  finish: () => Promise<void>;
  stop: () => Promise<void>;
};

export type ConversationSessionSnapshot = {
  id: string | null;
  turns: ChatTurn[];
  isRecording: boolean;
  isStreaming: boolean;
  voice: VoiceLifecycle;
  latency: VoiceLatency;
  traceContext: VoiceTraceContext;
  closeout: unknown;
};

type TimerHandle = unknown;

type EndpointReason =
  | "manual"
  | "native-endpoint"
  | "initial-silence"
  | "audio-silence"
  | "transcript-silence"
  | "utterance-limit";

export type ConversationFailure =
  | "permissionDenied"
  | "noSpeech"
  | "network"
  | "sttFailure"
  | "providerFailure"
  | "providerTimeout"
  | "audioInterruption"
  | "playbackFailure"
  | "audioContract"
  | "cancelled";

export type ConversationDependencies = {
  speechInput: {
    start: (options: {
      onEvent: (event: TranscriptInputEvent) => void;
      onAudioEnergy: (energy: number) => void;
      trace: VoiceTraceContext;
    }) => Promise<SpeechInputHandle>;
  };
  /** Present only in development/test adapters. The implementation must call
   * the real recorded-file STT boundary and return the original audio URI. */
  recordedSpeechInput?: {
    transcribe: (
      input: { uri: string; filename?: string; mimeType?: string },
      trace: VoiceTraceContext,
    ) => Promise<{
      text: string;
      audioUri: string;
      metadata: {
        format: "mp3" | "m4a" | "wav";
        byteCount: number;
        sampleRate: number;
        channels: number;
        durationMs: number;
      };
    }>;
  };
  replyStream: (options: {
    history: Array<{ role: "user" | "assistant"; content: string }>;
    userTurn: string;
    signal: AbortSignal;
    trace: VoiceTraceContext;
  }) => AsyncGenerator<ConversationChunk, ConversationResult, void>;
  audio: {
    createQueue: (options: {
      captureKey: string;
      trace: VoiceTraceContext;
      onCaptured: (audioUri: string) => void;
      onStarted: () => void;
      onFinished: () => void;
      onError: (error: Error) => void;
    }) => PlaybackQueue;
    save: (
      audioBase64: string,
      cacheKey: string,
      format: string,
    ) => Promise<string>;
    synthesize: (
      text: string,
      options: { trace?: VoiceTraceContext; withTimestamps?: boolean },
    ) => Promise<{ audioUri: string }>;
    play: (
      audioUri: string,
      options: {
        trace?: VoiceTraceContext;
        onStarted?: () => void;
        onFinished?: () => void;
        onError?: (error: Error) => void;
      },
    ) => Promise<void>;
    stop: () => Promise<void>;
  };
  pronunciation: {
    analyze: (options: {
      targetText: string;
      attemptAudioUri: string;
      previous?: ChatTurn;
    }) => Promise<{
      referenceAudioUri: string;
      pronunciation: PronunciationFeedback;
    }>;
  };
  session: {
    snapshot: () => ConversationSessionSnapshot;
    start: (sessionId: string) => Promise<void>;
    addTurn: (turn: ChatTurn) => void;
    patchTurn: (turnId: string, patch: Partial<ChatTurn>) => void;
    appendAssistantText: (turnId: string, chunk: string) => void;
    setRecording: (recording: boolean) => void;
    setStreaming: (streaming: boolean) => void;
    setVoice: (voice: VoiceLifecycle) => void;
    setVoicePhase: (phase: VoicePhase, patch?: Partial<VoiceLifecycle>) => void;
    setInterimTranscript: (text: string) => void;
    setLatency: (latency: VoiceLatency) => void;
    setTraceContext: (trace: Omit<VoiceTraceContext, "sessionId">) => void;
    prepareCloseout: () => Promise<unknown>;
    end: () => Promise<void>;
  };
  clock: {
    now: () => number;
    setTimer: (callback: () => void, delayMs: number) => TimerHandle;
    clearTimer: (handle: TimerHandle) => void;
  };
  ids: { next: () => string };
  telemetry: (
    event: string,
    trace?: VoiceTraceContext,
    fields?: Record<string, string | number | boolean | null | undefined>,
    level?: "info" | "warn" | "error",
  ) => void;
  logger: { warn: (...values: unknown[]) => void };
  classifyError: (error: unknown) => ConversationFailure;
  errorName: (error: unknown) => string;
  haptics: { tap: () => void; success: () => void; fail: () => void };
  openSettings: () => Promise<void>;
  shouldAutoSend: (input: {
    intro?: string;
    existingTurnCount: number;
    transcript: string;
  }) => boolean;
};

export class RecordedAudioInjectionUnavailableError extends Error {
  constructor(message = "Recorded-audio injection is unavailable") {
    super(message);
    this.name = "RecordedAudioInjectionUnavailableError";
  }
}

export class NoPlayableAudioError extends Error {
  constructor(message = "The provider reply contained no playable audio") {
    super(message);
    this.name = "NoPlayableAudioError";
  }
}

type FailedReply = {
  text: string;
  audioUri?: string;
  assistantTurnId: string;
  traceTurnId: string;
};

type PendingEnrichment = {
  completion: Promise<void>;
  cancel: () => void;
};

type ActiveCapture = {
  token: number;
  traceTurnId: string;
  startedAt: number;
  ready: Promise<SpeechInputHandle>;
  handle?: SpeechInputHandle;
  finalTranscript: string;
};

const LEGAL_TRANSITIONS: Record<ConversationPhase, ConversationPhase[]> = {
  idle: [
    "start",
    "listening",
    "finalizing",
    "understanding",
    "recovery",
    "ending",
  ],
  start: ["idle", "listening", "recovery", "ending"],
  listening: ["endpoint", "resuming", "recovery", "ending"],
  endpoint: ["finalizing", "idle", "recovery", "ending"],
  finalizing: ["idle", "understanding", "recovery", "ending"],
  understanding: ["speaking", "resuming", "recovery", "listening", "ending"],
  speaking: ["resuming", "recovery", "listening", "ending"],
  resuming: ["idle", "listening", "understanding", "recovery", "ending"],
  recovery: ["idle", "resuming", "listening", "understanding", "ending"],
  ending: ["resuming", "ended"],
  ended: [],
};

const EMPTY_OWNERSHIP: ConversationOwnership = {
  audioSession: "none",
  microphone: null,
  providerRequest: null,
  playbackQueue: null,
  retry: null,
};

/**
 * Owns a conversation's asynchronous resources. React and diagnostic callers
 * both enter through these intent methods; providers never coordinate each
 * other outside this class.
 */
export class ConversationEngine {
  private state: ConversationEngineState = {
    phase: "idle",
    handsFreeActive: false,
    ownership: EMPTY_OWNERSHIP,
    draftTranscript: "",
    retryingTurnId: null,
    showCoda: false,
  };
  private readonly listeners = new Set<() => void>();
  private readonly responseRuns = new ResponseRunController();
  private latency: VoiceLatencyTracker;
  private capture?: ActiveCapture;
  private captureGeneration = 0;
  private eventGeneration = 0;
  private failedReply?: FailedReply;
  private responseQueue?: PlaybackQueue;
  private stopPromise?: Promise<void>;
  private stoppingCaptureToken?: number;
  private endpointTimer?: TimerHandle;
  private utteranceLimitTimer?: TimerHandle;
  private settleTimer?: TimerHandle;
  private startPromise?: Promise<void>;
  private closeoutPreparation: Promise<unknown> = Promise.resolve();
  private interruptionCleanup: Promise<unknown> = Promise.resolve();
  private readonly pendingEnrichment = new Set<PendingEnrichment>();
  private pendingPronunciationTurnId?: string;
  private resumeListening = false;
  private disposed = false;

  constructor(
    private readonly sessionId: string,
    private readonly intro: string | undefined,
    private readonly dependencies: ConversationDependencies,
  ) {
    this.latency = new VoiceLatencyTracker(dependencies.clock.now);
  }

  readonly getState = (): ConversationEngineState => this.state;

  /** Resource-only snapshot for soak/runtime diagnostics. Never includes text,
   * audio, IDs, request bodies, or credentials. */
  readonly getDiagnostics = (): ConversationEngineDiagnostics => ({
    disposed: this.disposed,
    listenerCount: this.listeners.size,
    activeResponseRunCount: this.responseRuns.hasActiveRun() ? 1 : 0,
    activeCaptureCount: this.capture ? 1 : 0,
    activePlaybackQueueCount: this.responseQueue ? 1 : 0,
    pendingTimerCount:
      Number(this.endpointTimer !== undefined) +
      Number(this.utteranceLimitTimer !== undefined) +
      Number(this.settleTimer !== undefined),
    pendingEnrichmentCount: this.pendingEnrichment.size,
  });

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.transition("start");
    this.startPromise = (async () => {
      if (this.dependencies.session.snapshot().id !== this.sessionId) {
        await this.dependencies.session.start(this.sessionId);
      }
      if (!this.disposed && this.state.phase === "start") {
        this.transition("idle");
      }
    })().catch((error) => {
      if (!this.disposed) this.enterRecovery("network");
      throw error;
    });
    return this.startPromise;
  }

  async startHandsFree(): Promise<void> {
    if (this.disposed) return;
    this.publish({ handsFreeActive: true });
    this.dependencies.telemetry(
      "hands_free_started",
      this.dependencies.session.snapshot().traceContext,
      {
        initialSilenceMs: HANDS_FREE_ENDPOINT.initialSilenceMs,
        interimSilenceMs: HANDS_FREE_ENDPOINT.interimSilenceMs,
        hesitationSilenceMs: HANDS_FREE_ENDPOINT.hesitationSilenceMs,
        finalResultGraceMs: HANDS_FREE_ENDPOINT.finalResultGraceMs,
      },
    );
    if (this.state.phase === "recovery") {
      await this.recover();
      return;
    }
    await this.startListening();
  }

  async pauseHandsFree(): Promise<void> {
    if (!this.state.handsFreeActive) return;
    this.publish({ handsFreeActive: false });
    this.resumeListening = false;
    this.clearCaptureTimers();
    this.dependencies.telemetry(
      "hands_free_paused",
      this.dependencies.session.snapshot().traceContext,
    );
    const capture = this.capture;
    if (!capture) return;
    ++this.eventGeneration;
    this.capture = undefined;
    this.dependencies.session.setRecording(false);
    this.dependencies.session.setVoicePhase("idle", { interimTranscript: "" });
    if (this.state.phase === "listening") {
      this.transition("resuming");
    }
    if (LEGAL_TRANSITIONS[this.state.phase].includes("idle"))
      this.transition("idle");
    this.publish({
      draftTranscript: "",
      draftAudioUri: undefined,
      ownership: EMPTY_OWNERSHIP,
    });
    await capture.ready.then((handle) => handle.cancel()).catch(() => {});
  }

  async bargeIn(): Promise<void> {
    this.publish({ handsFreeActive: true });
    await this.startListening();
  }

  async startListening(): Promise<void> {
    await this.start();
    if (
      this.disposed ||
      this.state.phase === "ending" ||
      this.state.phase === "ended"
    )
      return;
    if (this.dependencies.session.snapshot().isRecording) return;

    const wasResponding =
      this.responseRuns.hasActiveRun() ||
      this.dependencies.session.snapshot().isStreaming;
    const epoch = wasResponding ? ++this.eventGeneration : this.eventGeneration;
    if (wasResponding) {
      this.dependencies.telemetry(
        "response_cancelled",
        this.dependencies.session.snapshot().traceContext,
        { reason: "barge-in" },
        "warn",
      );
      this.dependencies.session.setVoicePhase("interrupted");
      await this.cancelResponse("barge-in");
      this.transition("resuming");
    }

    const token = ++this.captureGeneration;
    const traceTurnId = this.dependencies.ids.next();
    this.dependencies.session.setTraceContext({ turnId: traceTurnId });
    const trace = { sessionId: this.sessionId, turnId: traceTurnId };
    this.latency = new VoiceLatencyTracker(this.dependencies.clock.now);
    this.latency.listeningStarted();
    this.dependencies.session.setLatency({});
    this.dependencies.session.setRecording(true);
    this.dependencies.session.setVoicePhase(
      this.state.retryingTurnId ? "retryListening" : "listening",
      { interimTranscript: "" },
    );
    this.transition("listening");
    this.publish({
      draftTranscript: "",
      draftAudioUri: undefined,
      ownership: {
        ...this.state.ownership,
        audioSession: "microphone",
        microphone: token,
      },
    });

    const ready = this.dependencies.speechInput.start({
      trace,
      onAudioEnergy: (energy) => {
        if (this.isCaptureCurrent(token, epoch)) {
          if (energy >= HANDS_FREE_ENDPOINT.audibleEnergy) {
            this.scheduleEndpoint(
              token,
              epoch,
              HANDS_FREE_ENDPOINT.interimSilenceMs,
              "audio-silence",
            );
          }
        }
      },
      onEvent: (event) => this.receiveTranscriptEvent(token, epoch, event),
    });
    const capture: ActiveCapture = {
      token,
      traceTurnId,
      startedAt: this.dependencies.clock.now(),
      ready,
      finalTranscript: "",
    };
    this.capture = capture;
    this.scheduleEndpoint(
      token,
      epoch,
      HANDS_FREE_ENDPOINT.initialSilenceMs,
      "initial-silence",
    );
    this.scheduleUtteranceLimit(token, epoch);
    try {
      const handle = await ready;
      if (!this.isCaptureCurrent(token, epoch)) {
        await handle.cancel();
        return;
      }
      capture.handle = handle;
    } catch (error) {
      if (!this.isCaptureCurrent(token, epoch)) return;
      this.capture = undefined;
      this.clearCaptureTimers();
      this.dependencies.session.setRecording(false);
      this.publish({
        ownership: {
          ...this.state.ownership,
          audioSession: "none",
          microphone: null,
        },
      });
      this.reportSpeechFailure(error, "start", trace);
    }
  }

  async stopListening(reason: EndpointReason = "manual"): Promise<void> {
    const captureToken = this.capture?.token;
    if (this.stopPromise) {
      if (this.stoppingCaptureToken === captureToken) return this.stopPromise;
      await this.stopPromise;
      return this.stopListening(reason);
    }
    const operation = this.finishListening(reason);
    this.stopPromise = operation;
    this.stoppingCaptureToken = captureToken;
    try {
      await operation;
    } finally {
      if (this.stopPromise === operation) {
        this.stopPromise = undefined;
        this.stoppingCaptureToken = undefined;
      }
    }
  }

  private async finishListening(reason: EndpointReason): Promise<void> {
    const capture = this.capture;
    if (!capture || this.state.phase !== "listening") return;
    const epoch = this.eventGeneration;
    this.clearCaptureTimers();
    this.transition("endpoint");
    this.dependencies.session.setRecording(false);
    this.publish({
      ownership: {
        ...this.state.ownership,
        audioSession: "none",
        microphone: null,
      },
    });
    const duration = this.dependencies.clock.now() - capture.startedAt;

    try {
      const handle = capture.handle ?? (await capture.ready);
      if (!this.isCaptureCurrent(capture.token, epoch, "endpoint")) {
        await handle.cancel();
        return;
      }
      if (
        duration < HANDS_FREE_ENDPOINT.minimumCaptureMs &&
        !capture.finalTranscript.trim() &&
        !this.state.draftTranscript.trim()
      ) {
        await handle.cancel();
        if (!this.isCaptureCurrent(capture.token, epoch, "endpoint")) return;
        this.capture = undefined;
        await this.handleNoSpeech(reason, capture.traceTurnId);
        return;
      }

      const result = await handle.stop();
      if (!this.isCaptureCurrent(capture.token, epoch, "endpoint")) return;
      this.capture = undefined;
      this.transition("finalizing");
      const transcript =
        result.fullText ||
        capture.finalTranscript ||
        this.state.draftTranscript;
      if (!transcript.trim()) {
        await this.handleNoSpeech(reason, capture.traceTurnId);
        return;
      }
      await this.finalizeTranscript(
        transcript,
        result.audioUri || undefined,
        capture.traceTurnId,
        this.state.handsFreeActive ||
          this.dependencies.shouldAutoSend({
            intro: this.intro,
            existingTurnCount:
              this.dependencies.session.snapshot().turns.length,
            transcript,
          }),
      );
    } catch (error) {
      if (!this.isEpochCurrent(epoch)) return;
      this.capture = undefined;
      if (this.dependencies.classifyError(error) === "noSpeech") {
        await this.handleNoSpeech(reason, capture.traceTurnId);
        return;
      }
      this.reportSpeechFailure(
        error,
        "final",
        this.dependencies.session.snapshot().traceContext,
      );
    }
  }

  /** Development/test entry point. The optional dependency is deliberately
   * omitted by Release adapters, and no caller can supply transcript text. */
  async injectRecordedAudio(input: {
    uri: string;
    filename?: string;
    mimeType?: string;
  }): Promise<void> {
    await this.start();
    const recordedSpeechInput = this.dependencies.recordedSpeechInput;
    if (!recordedSpeechInput) {
      throw new RecordedAudioInjectionUnavailableError();
    }
    if (
      this.disposed ||
      this.state.phase === "ending" ||
      this.state.phase === "ended"
    )
      return;
    const wasResponding =
      this.responseRuns.hasActiveRun() ||
      this.dependencies.session.snapshot().isStreaming;
    if (wasResponding) {
      this.dependencies.telemetry(
        "response_cancelled",
        this.dependencies.session.snapshot().traceContext,
        { reason: "recorded-file-barge-in" },
        "warn",
      );
      this.dependencies.session.setVoicePhase("interrupted");
      await this.cancelResponse("recorded-file-barge-in");
      if (
        this.state.phase === "understanding" ||
        this.state.phase === "speaking"
      ) {
        this.transition("resuming");
      }
    }
    if (this.state.phase === "recovery") {
      this.dependencies.session.setVoicePhase("idle", {
        interimTranscript: "",
      });
      this.transition("idle");
    }
    if (this.state.phase !== "idle" && this.state.phase !== "resuming") {
      throw new RecordedAudioInjectionUnavailableError(
        `Recorded-audio injection requires an idle engine, not ${this.state.phase}`,
      );
    }

    const epoch = ++this.eventGeneration;
    const traceTurnId = this.dependencies.ids.next();
    const trace = { sessionId: this.sessionId, turnId: traceTurnId };
    this.dependencies.session.setTraceContext({ turnId: traceTurnId });
    this.latency = new VoiceLatencyTracker(this.dependencies.clock.now);
    this.latency.listeningStarted();
    this.dependencies.session.setLatency({});
    this.dependencies.session.setVoicePhase("listening", {
      interimTranscript: "",
    });
    this.transition("listening");
    this.publish({
      draftTranscript: "",
      draftAudioUri: undefined,
      ownership: EMPTY_OWNERSHIP,
    });
    this.dependencies.telemetry("recorded_audio_injection_started", trace, {
      path: "async-rest-recorded-file",
      target: "iPhone Simulator",
    });

    try {
      const result = await recordedSpeechInput.transcribe(input, trace);
      if (!this.isEpochCurrent(epoch) || !this.isPhase("listening")) return;
      const latency = this.latency.transcriptReceived();
      this.updateLatency(latency, "listeningToTranscriptMs");
      this.transition("endpoint");
      this.dependencies.session.setInterimTranscript(result.text);
      this.transition("finalizing");
      this.dependencies.telemetry("recorded_audio_injection_completed", trace, {
        path: "async-rest-recorded-file",
        declaredEncoding: result.metadata.format,
        observedEncoding: result.metadata.format,
        byteCount: result.metadata.byteCount,
        sampleRate: result.metadata.sampleRate,
        channels: result.metadata.channels,
        durationMs: Math.round(result.metadata.durationMs),
        transcriptChars: result.text.trim().length,
      });
      await this.finalizeTranscript(
        result.text,
        result.audioUri,
        traceTurnId,
        true,
      );
    } catch (error) {
      if (!this.isEpochCurrent(epoch)) return;
      this.reportSpeechFailure(error, "final", trace);
    }
  }

  editTranscript(text: string): void {
    if (this.state.phase !== "finalizing") return;
    this.publish({ draftTranscript: text });
  }

  async submitTranscript(): Promise<void> {
    if (this.state.phase !== "finalizing") return;
    const text = this.state.draftTranscript.trim();
    if (!text) {
      this.enterRecovery("sttFailure", "silence");
      return;
    }
    const traceTurnId =
      this.capture?.traceTurnId ??
      this.dependencies.session.snapshot().traceContext.turnId;
    if (this.state.retryingTurnId) {
      await this.submitPronunciationRetry(
        this.state.retryingTurnId,
        text,
        this.state.draftAudioUri,
        traceTurnId,
      );
      return;
    }
    const audioUri = this.state.draftAudioUri;
    this.publish({ draftTranscript: "", draftAudioUri: undefined });
    await this.sendUser(text, audioUri, undefined, traceTurnId);
  }

  discardTranscript(): void {
    ++this.eventGeneration;
    this.capture = undefined;
    this.dependencies.session.setVoicePhase("idle", { interimTranscript: "" });
    this.transition("idle");
    this.publish({
      draftTranscript: "",
      draftAudioUri: undefined,
      retryingTurnId: null,
      ownership: EMPTY_OWNERSHIP,
    });
  }

  async recover(): Promise<void> {
    const recovery = this.dependencies.session.snapshot().voice.recovery;
    if (recovery === "openSettings") {
      await this.dependencies.openSettings();
      return;
    }
    if (recovery === "retryResponse" && this.failedReply) {
      const failed = this.failedReply;
      this.dependencies.telemetry(
        "response_retry",
        { sessionId: this.sessionId, turnId: failed.traceTurnId },
        { retry: true },
        "warn",
      );
      await this.sendUser(
        failed.text,
        failed.audioUri,
        failed.assistantTurnId,
        failed.traceTurnId,
      );
      return;
    }
    if (recovery === "resume") {
      await this.resume();
      return;
    }
    this.failedReply = undefined;
    this.dependencies.session.setVoicePhase("idle", { interimTranscript: "" });
    this.transition("idle");
    this.publish({
      ownership: { ...this.state.ownership, retry: null },
    });
    if (this.state.handsFreeActive) await this.startListening();
  }

  async interrupt(kind: "app" | "audio"): Promise<void> {
    if (
      this.state.phase === "ending" ||
      this.state.phase === "ended" ||
      this.disposed
    )
      return;
    if (this.state.phase === "recovery") return;
    const session = this.dependencies.session.snapshot();
    if (
      (this.state.phase === "idle" || this.state.phase === "start") &&
      !this.state.handsFreeActive &&
      !this.capture &&
      !this.responseRuns.hasActiveRun() &&
      !session.isRecording &&
      !session.isStreaming
    )
      return;
    this.resumeListening ||=
      this.state.handsFreeActive || this.state.phase === "listening";
    ++this.eventGeneration;
    const capture = this.capture;
    this.capture = undefined;
    const interruptedTurnId = this.responseRuns.invalidate();
    if (interruptedTurnId) {
      this.dependencies.session.patchTurn(interruptedTurnId, {
        streaming: false,
        interrupted: true,
      });
    }
    const queue = this.responseQueue;
    this.responseQueue = undefined;
    this.cancelPendingEnrichment(
      kind === "app" ? "app-interruption" : "audio-interruption",
    );
    this.clearCaptureTimers();
    this.dependencies.session.setRecording(false);
    this.dependencies.session.setStreaming(false);
    this.transition("recovery");
    this.publish({
      ownership: EMPTY_OWNERSHIP,
    });
    this.dependencies.session.setVoice(
      voiceError(
        "audioInterruption",
        kind === "app" ? "Koe paused while the app was inactive." : undefined,
      ),
    );
    this.interruptionCleanup = Promise.allSettled([
      this.interruptionCleanup,
      capture?.ready.then((handle) => handle.cancel()) ?? Promise.resolve(),
      queue?.stop() ?? Promise.resolve(),
      this.dependencies.audio.stop(),
    ]);
    await this.interruptionCleanup;
  }

  async resume(): Promise<void> {
    if (this.state.phase !== "recovery" || this.disposed) return;
    const errorKind = this.dependencies.session.snapshot().voice.errorKind;
    if (errorKind !== "audioInterruption" && errorKind !== "permissionDenied")
      return;
    const resumeListening = this.resumeListening || this.state.handsFreeActive;
    this.resumeListening = false;
    this.transition("resuming");
    this.dependencies.session.setVoicePhase("idle", { interimTranscript: "" });
    await this.interruptionCleanup;
    if (!this.isPhase("resuming") || this.disposed) return;
    if (resumeListening) {
      await this.startListening();
    } else {
      this.transition("idle");
    }
  }

  async startPronunciationRetry(turnId: string): Promise<void> {
    this.dependencies.haptics.tap();
    ++this.eventGeneration;
    const capture = this.capture;
    this.capture = undefined;
    this.clearCaptureTimers();
    this.dependencies.session.setRecording(false);
    await capture?.ready.then((handle) => handle.cancel()).catch(() => {});
    await this.cancelResponse("pronunciation-retry");
    if (
      this.state.phase === "understanding" ||
      this.state.phase === "speaking" ||
      this.state.phase === "listening"
    ) {
      this.transition("resuming");
    }
    if (this.state.phase !== "idle") this.transition("idle");
    this.dependencies.session.setVoicePhase("retryListening", {
      interimTranscript: "",
    });
    this.publish({
      retryingTurnId: turnId,
      draftTranscript: "",
      draftAudioUri: undefined,
      ownership: EMPTY_OWNERSHIP,
    });
    await this.startListening();
  }

  async playAudio(audioUri: string): Promise<void> {
    await this.dependencies.audio.play(audioUri, {});
  }

  requestEnd(): void {
    if (this.state.phase === "ending" || this.state.phase === "ended") return;
    this.dependencies.haptics.tap();
    ++this.eventGeneration;
    const interruptedTurnId = this.responseRuns.invalidate();
    if (interruptedTurnId) {
      this.dependencies.session.patchTurn(interruptedTurnId, {
        streaming: false,
        interrupted: true,
      });
    }
    const capture = this.capture;
    this.capture = undefined;
    const queue = this.responseQueue;
    this.responseQueue = undefined;
    this.cancelPendingEnrichment("session-end");
    this.clearCaptureTimers();
    this.clearSettleTimer();
    this.dependencies.telemetry(
      "session_cancelled",
      this.dependencies.session.snapshot().traceContext,
      { reason: "user-ended-session" },
      "warn",
    );
    this.dependencies.session.setRecording(false);
    this.dependencies.session.setStreaming(false);
    this.transition("ending");
    this.publish({
      handsFreeActive: false,
      showCoda: true,
      ownership: EMPTY_OWNERSHIP,
    });
    this.closeoutPreparation = Promise.allSettled([
      capture?.ready.then((handle) => handle.cancel()) ?? Promise.resolve(),
      queue?.stop() ?? Promise.resolve(),
      this.dependencies.audio.stop(),
    ]).then(() => this.dependencies.session.prepareCloseout());
  }

  async finishEnd(): Promise<void> {
    if (this.state.phase !== "ending") return;
    await this.closeoutPreparation;
    await this.dependencies.session.end();
    this.transition("ended");
    this.publish({ showCoda: false, ownership: EMPTY_OWNERSHIP });
  }

  continueAfterCoda(): void {
    if (this.state.phase !== "ending") {
      this.publish({ showCoda: false });
      return;
    }
    this.transition("resuming");
    this.dependencies.session.setVoicePhase("idle", { interimTranscript: "" });
    this.publish({ showCoda: false, handsFreeActive: true });
    this.transition("idle");
    void this.startListening();
  }

  async endImmediately(): Promise<void> {
    this.requestEnd();
    await this.finishEnd();
  }

  setReviewState(options: {
    phase?: VoicePhase;
    draftTranscript?: string;
    showCoda?: boolean;
  }): void {
    if (options.phase) this.dependencies.session.setVoicePhase(options.phase);
    this.publish({
      draftTranscript: options.draftTranscript ?? this.state.draftTranscript,
      showCoda: options.showCoda ?? this.state.showCoda,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.eventGeneration;
    const interruptedTurnId = this.responseRuns.invalidate();
    if (interruptedTurnId) {
      this.dependencies.session.patchTurn(interruptedTurnId, {
        streaming: false,
        interrupted: true,
      });
    }
    this.dependencies.session.setRecording(false);
    this.dependencies.session.setStreaming(false);
    this.clearSettleTimer();
    this.clearCaptureTimers();
    this.cancelPendingEnrichment("dispose");
    const capture = this.capture;
    this.capture = undefined;
    void capture?.ready.then((handle) => handle.cancel()).catch(() => {});
    void this.responseQueue?.stop().catch(() => {});
    void this.dependencies.audio.stop();
    this.listeners.clear();
  }

  private receiveTranscriptEvent(
    token: number,
    epoch: number,
    event: TranscriptInputEvent,
  ): void {
    if (!this.isCaptureCurrent(token, epoch)) return;
    if (event.type === "failure") {
      void this.failActiveCapture(token, epoch, event.error);
      return;
    }
    if (event.type === "endpoint") {
      void this.stopListening("native-endpoint");
      return;
    }
    if (event.type === "speechStart") {
      this.scheduleEndpoint(
        token,
        epoch,
        HANDS_FREE_ENDPOINT.interimSilenceMs,
        "audio-silence",
      );
      return;
    }
    if (event.type === "speechEnd") {
      this.scheduleTranscriptEndpoint(token, epoch, "speechEnd");
      return;
    }
    const capture = this.capture;
    if (!capture) return;
    if (event.type === "final") capture.finalTranscript = event.text;
    const previous =
      this.dependencies.session.snapshot().latency.listeningToTranscriptMs;
    const latency = this.latency.transcriptReceived();
    if (previous === undefined) {
      this.updateLatency(latency, "listeningToTranscriptMs");
    }
    this.publish({ draftTranscript: event.text });
    this.dependencies.session.setInterimTranscript(event.text);
    this.scheduleTranscriptEndpoint(token, epoch, event.type, event.text);
  }

  private async finalizeTranscript(
    text: string,
    audioUri: string | undefined,
    traceTurnId: string,
    autoSend: boolean,
  ): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      this.enterRecovery("sttFailure", "silence");
      return;
    }
    this.publish({ draftTranscript: trimmed, draftAudioUri: audioUri });
    if (!autoSend) {
      this.dependencies.session.setVoicePhase("transcriptCheck", {
        interimTranscript: trimmed,
      });
      return;
    }
    this.publish({ draftTranscript: "", draftAudioUri: undefined });
    await this.sendUser(trimmed, audioUri, undefined, traceTurnId);
  }

  private async sendUser(
    text: string,
    audioUri?: string,
    retryAssistantTurnId?: string,
    existingTraceTurnId?: string,
  ): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      this.enterRecovery("sttFailure", "silence");
      return;
    }
    if (this.state.phase === "recovery") this.transition("resuming");
    if (
      this.state.phase === "finalizing" ||
      this.state.phase === "resuming" ||
      this.state.phase === "idle"
    ) {
      this.transition("understanding");
    }

    const epoch = ++this.eventGeneration;
    this.cancelPendingEnrichment("superseded-by-turn");
    const previousTrace = this.dependencies.session.snapshot().traceContext;
    const interruptedTurnId = this.responseRuns.interrupt();
    if (interruptedTurnId && interruptedTurnId !== retryAssistantTurnId) {
      this.dependencies.telemetry(
        "response_cancelled",
        previousTrace,
        { reason: "superseded-by-turn" },
        "warn",
      );
      this.dependencies.session.patchTurn(interruptedTurnId, {
        streaming: false,
        interrupted: true,
      });
    }
    const previousQueue = this.responseQueue;
    this.responseQueue = undefined;
    await Promise.allSettled([
      previousQueue?.stop() ?? Promise.resolve(),
      this.dependencies.audio.stop(),
    ]);

    const assistantTurnId =
      retryAssistantTurnId ?? this.dependencies.ids.next();
    const traceTurnId =
      existingTraceTurnId ??
      (retryAssistantTurnId
        ? (this.failedReply?.traceTurnId ?? this.dependencies.ids.next())
        : this.dependencies.ids.next());
    const responseRunId = this.dependencies.ids.next();
    const trace: VoiceTraceContext = {
      sessionId: this.sessionId,
      turnId: traceTurnId,
      responseRunId,
    };
    this.dependencies.session.setTraceContext({
      turnId: traceTurnId,
      responseRunId,
    });
    this.dependencies.telemetry("response_run_started", trace, {
      retry: Boolean(retryAssistantTurnId),
      capturedAudio: Boolean(audioUri),
    });

    let userTurnId: string | undefined;
    if (retryAssistantTurnId) {
      this.dependencies.session.patchTurn(assistantTurnId, {
        textJa: "",
        streaming: true,
        interrupted: false,
        corrections: undefined,
        traceTurnId,
        responseRunId,
      });
    } else {
      userTurnId = traceTurnId;
      this.dependencies.session.addTurn({
        id: userTurnId,
        role: "user",
        textJa: trimmed,
        audioUri,
        attemptNumber: audioUri ? 1 : undefined,
        createdAt: this.dependencies.clock.now(),
        traceTurnId,
        responseRunId,
      });
      this.dependencies.session.addTurn({
        id: assistantTurnId,
        role: "assistant",
        textJa: "",
        streaming: true,
        createdAt: this.dependencies.clock.now(),
        traceTurnId,
        responseRunId,
      });
      this.dependencies.haptics.success();
    }

    const responseRun = this.responseRuns.start(assistantTurnId);
    this.failedReply = undefined;
    this.dependencies.session.setStreaming(true);
    this.dependencies.session.setVoicePhase(
      retryAssistantTurnId ? "responseRetry" : "understanding",
      { interimTranscript: "" },
    );
    this.latency.transcriptCommitted();
    this.publish({
      ownership: {
        audioSession: "none",
        microphone: null,
        providerRequest: responseRun.token,
        playbackQueue: responseRun.token,
        retry: null,
      },
    });

    if (userTurnId && audioUri) {
      void this.analyzeUserPronunciation(
        userTurnId,
        trimmed,
        audioUri,
        undefined,
        epoch,
      );
    }

    await this.runReply({
      trimmed,
      audioUri,
      assistantTurnId,
      traceTurnId,
      trace,
      userTurnId,
      retry: Boolean(retryAssistantTurnId),
      responseRun,
      epoch,
    });
  }

  private async runReply(input: {
    trimmed: string;
    audioUri?: string;
    assistantTurnId: string;
    traceTurnId: string;
    trace: VoiceTraceContext;
    userTurnId?: string;
    retry: boolean;
    responseRun: ResponseRun;
    epoch: number;
  }): Promise<void> {
    let receivedText = false;
    let receivedStreamAudio = false;
    let providerAudioUri: string | undefined;
    let playbackFailed = false;
    let reply = "";
    const isCurrent = () =>
      this.isEpochCurrent(input.epoch) &&
      this.responseRuns.isCurrent(
        input.assistantTurnId,
        input.responseRun.token,
      );
    const handlePlaybackFailure = (error: Error) => {
      if (playbackFailed || !isCurrent()) return;
      playbackFailed = true;
      this.dependencies.telemetry(
        "playback_failed",
        input.trace,
        {
          failureKind: "callback",
          errorName: this.dependencies.errorName(error),
        },
        "error",
      );
      this.failedReply = {
        text: input.trimmed,
        audioUri: input.audioUri,
        assistantTurnId: input.assistantTurnId,
        traceTurnId: input.traceTurnId,
      };
      this.responseRuns.interrupt();
      this.dependencies.session.setStreaming(false);
      this.dependencies.session.patchTurn(input.assistantTurnId, {
        streaming: false,
      });
      this.responseQueue = undefined;
      this.dependencies.haptics.fail();
      const failure = this.dependencies.classifyError(error);
      this.resumeListening =
        failure === "audioInterruption" && this.state.handsFreeActive;
      this.transition("recovery");
      this.publish({
        ownership: {
          ...EMPTY_OWNERSHIP,
          retry: input.assistantTurnId,
        },
      });
      this.dependencies.session.setVoice(
        voiceError(
          failure === "audioInterruption"
            ? "audioInterruption"
            : "playbackFailure",
        ),
      );
    };
    const handlePlaybackStarted = () => {
      if (!isCurrent()) return;
      const latency = this.latency.firstAudioPlayed();
      this.updateLatency(latency, "firstTextToFirstAudioMs");
      this.transition("speaking");
      this.publish({
        ownership: { ...this.state.ownership, audioSession: "playback" },
      });
      this.dependencies.session.setVoicePhase("speaking");
    };
    const handlePlaybackFinished = () => {
      if (!isCurrent()) return;
      this.settleReply(input.responseRun, input.retry);
    };
    let queue: PlaybackQueue | undefined;
    const responseQueue = () => {
      if (queue) return queue;
      queue = this.dependencies.audio.createQueue({
        captureKey: input.assistantTurnId,
        trace: input.trace,
        onCaptured: (audioUri) => {
          if (isCurrent())
            this.dependencies.session.patchTurn(input.assistantTurnId, {
              audioUri,
            });
        },
        onStarted: handlePlaybackStarted,
        onFinished: handlePlaybackFinished,
        onError: handlePlaybackFailure,
      });
      this.responseQueue = queue;
      return queue;
    };
    const playAudioFile = async (audioUri: string) => {
      this.dependencies.session.patchTurn(input.assistantTurnId, { audioUri });
      await this.dependencies.audio.play(audioUri, {
        trace: input.trace,
        onStarted: handlePlaybackStarted,
        onFinished: handlePlaybackFinished,
        onError: handlePlaybackFailure,
      });
    };

    try {
      const historyWithUser = this.dependencies.session
        .snapshot()
        .turns.filter(
          (turn) => turn.id !== input.assistantTurnId && turn.textJa,
        )
        .map((turn) => ({ role: turn.role, content: turn.textJa }));
      const generator = this.dependencies.replyStream({
        history: historyWithUser.slice(0, -1),
        userTurn: input.trimmed,
        signal: input.responseRun.signal,
        trace: input.trace,
      });
      while (true) {
        const next = await generator.next();
        if (!isCurrent()) {
          await queue?.stop();
          return;
        }
        if (next.done) {
          const result = next.value;
          const finalText = result.fullText || reply;
          this.publish({
            ownership: {
              ...this.state.ownership,
              providerRequest: null,
            },
          });
          this.dependencies.session.patchTurn(input.assistantTurnId, {
            textJa: finalText,
            streaming: false,
          });
          if (input.userTurnId) {
            let cancelRace = () => {};
            const cancelled = new Promise<{ kind: "cancelled" }>((resolve) => {
              cancelRace = () => resolve({ kind: "cancelled" });
            });
            const completion = Promise.race([
              result.feedback.then((feedback) => ({
                kind: "feedback" as const,
                feedback,
              })),
              cancelled,
            ]).then(async (outcome) => {
              if (
                outcome.kind === "cancelled" ||
                !this.isEpochCurrent(input.epoch)
              )
                return;
              this.dependencies.session.patchTurn(input.userTurnId!, {
                corrections: outcome.feedback.corrections,
                textEn: outcome.feedback.translations.user,
              });
              this.dependencies.session.patchTurn(input.assistantTurnId, {
                textEn: outcome.feedback.translations.tutor,
              });
              if (this.dependencies.session.snapshot().closeout) {
                await this.dependencies.session.prepareCloseout();
              }
            });
            const enrichment: PendingEnrichment = {
              completion,
              cancel: () => {
                input.responseRun.cancel();
                cancelRace();
              },
            };
            this.pendingEnrichment.add(enrichment);
            void completion.finally(() =>
              this.pendingEnrichment.delete(enrichment),
            );
          }
          this.failedReply = undefined;
          if (receivedStreamAudio) {
            await responseQueue().finish();
          } else if (providerAudioUri) {
            await playAudioFile(providerAudioUri);
          } else {
            if (!isCurrent()) return;
            this.dependencies.telemetry(
              "response_fallback",
              input.trace,
              { path: "standalone-tts", reason: "stream-contained-no-audio" },
              "warn",
            );
            const synthesized = await this.dependencies.audio.synthesize(
              finalText,
              { trace: input.trace },
            );
            if (!isCurrent()) return;
            if (!synthesized.audioUri) {
              throw new NoPlayableAudioError(
                "Standalone TTS returned no playable audio",
              );
            }
            await playAudioFile(synthesized.audioUri);
          }
          return;
        }

        const chunk = next.value;
        if (chunk.type === "text") {
          reply += chunk.text;
          this.dependencies.session.appendAssistantText(
            input.assistantTurnId,
            chunk.text,
          );
          if (!receivedText) {
            receivedText = true;
            const latency = this.latency.firstTextReceived();
            this.updateLatency(latency, "transcriptToFirstTextMs");
            this.dependencies.session.setVoicePhase("firstReply");
          }
        } else if (chunk.type === "audio") {
          if (providerAudioUri) {
            throw new Error("Provider mixed PCM and encoded reply audio");
          }
          receivedStreamAudio = true;
          await responseQueue().enqueue(
            chunk.audioBase64,
            chunk.sampleRate,
            chunk.channels,
          );
          if (!isCurrent()) return;
        } else {
          if (receivedStreamAudio || providerAudioUri) {
            throw new Error("Provider returned conflicting reply audio");
          }
          providerAudioUri = await this.dependencies.audio.save(
            chunk.audioBase64,
            `provider-${input.assistantTurnId}-${input.trace.responseRunId}`,
            chunk.encoding,
          );
          this.dependencies.telemetry("provider_audio_persisted", input.trace, {
            path: "provider-json-compat",
            declaredEncoding: chunk.encoding,
            observedEncoding: chunk.encoding,
            sampleRate: chunk.sampleRate,
            channels: chunk.channels,
            byteCount: chunk.byteCount,
          });
          if (!isCurrent()) return;
        }
      }
    } catch (error) {
      await queue?.stop();
      if (!isCurrent()) return;
      if (
        input.responseRun.signal.aborted &&
        this.dependencies.classifyError(error) !== "providerTimeout"
      ) {
        this.dependencies.session.patchTurn(input.assistantTurnId, {
          streaming: false,
          interrupted: !playbackFailed,
        });
        return;
      }
      this.dependencies.telemetry(
        "response_run_failed",
        input.trace,
        {
          failureKind:
            this.dependencies.classifyError(error) === "audioContract"
              ? "decode"
              : this.dependencies.classifyError(error) === "providerTimeout"
                ? "timeout"
                : this.dependencies.classifyError(error) === "playbackFailure"
                  ? "playback"
                  : "provider",
          errorName: this.dependencies.errorName(error),
        },
        "error",
      );
      this.responseRuns.complete(
        input.assistantTurnId,
        input.responseRun.token,
      );
      this.responseQueue = undefined;
      this.failedReply = {
        text: input.trimmed,
        audioUri: input.audioUri,
        assistantTurnId: input.assistantTurnId,
        traceTurnId: input.traceTurnId,
      };
      this.dependencies.session.patchTurn(input.assistantTurnId, {
        textJa: reply || "Koe could not finish that reply.",
        streaming: false,
      });
      const failure = this.dependencies.classifyError(error);
      this.resumeListening =
        failure === "audioInterruption" && this.state.handsFreeActive;
      this.enterRecovery(
        failure === "providerTimeout"
          ? "providerTimeout"
          : failure === "audioInterruption"
            ? "audioInterruption"
            : failure === "audioContract" || failure === "playbackFailure"
              ? "playbackFailure"
              : failure === "providerFailure"
                ? "providerFailure"
                : "network",
      );
      this.publish({
        ownership: { ...this.state.ownership, retry: input.assistantTurnId },
      });
    } finally {
      if (this.responseRuns.isLatest(input.responseRun.token)) {
        this.dependencies.session.setStreaming(false);
      }
    }
  }

  private async submitPronunciationRetry(
    previousTurnId: string,
    transcript: string,
    audioUri: string | undefined,
    traceTurnId?: string,
  ): Promise<void> {
    const previous = this.dependencies.session
      .snapshot()
      .turns.find((turn) => turn.id === previousTurnId);
    if (!previous || !audioUri) {
      this.publish({ retryingTurnId: null });
      this.enterRecovery("sttFailure");
      return;
    }
    const epoch = ++this.eventGeneration;
    const turnId = traceTurnId ?? this.dependencies.ids.next();
    const targetText = previous.pronunciation?.targetText ?? previous.textJa;
    this.dependencies.session.addTurn({
      id: turnId,
      role: "user",
      textJa: transcript,
      audioUri,
      referenceAudioUri: previous.referenceAudioUri,
      retryOfTurnId: previous.id,
      attemptNumber: (previous.attemptNumber ?? 1) + 1,
      createdAt: this.dependencies.clock.now(),
      traceTurnId: turnId,
    });
    this.dependencies.session.setVoicePhase("comparing", {
      interimTranscript: "",
    });
    this.transition("understanding");
    this.publish({
      retryingTurnId: null,
      draftTranscript: "",
      draftAudioUri: undefined,
      ownership: {
        ...EMPTY_OWNERSHIP,
        providerRequest: epoch,
      },
    });
    const result = await this.analyzeUserPronunciation(
      turnId,
      targetText,
      audioUri,
      previous,
      epoch,
    );
    if (!this.isEpochCurrent(epoch)) return;
    if (result) {
      this.dependencies.session.setVoicePhase("success");
      result.retry?.targetImproved
        ? this.dependencies.haptics.success()
        : this.dependencies.haptics.tap();
      this.transition("resuming");
      this.clearSettleTimer();
      this.settleTimer = this.dependencies.clock.setTimer(() => {
        this.settleTimer = undefined;
        if (!this.isEpochCurrent(epoch) || this.state.phase !== "resuming")
          return;
        if (this.dependencies.session.snapshot().voice.phase === "success") {
          this.dependencies.session.setVoicePhase("idle");
        }
        this.transition("idle");
        if (this.state.handsFreeActive) void this.startListening();
      }, 1_400);
    } else {
      this.enterRecovery("sttFailure");
    }
  }

  private async analyzeUserPronunciation(
    turnId: string,
    targetText: string,
    attemptAudioUri: string,
    previous: ChatTurn | undefined,
    epoch: number,
  ): Promise<PronunciationFeedback | undefined> {
    try {
      const result = await this.dependencies.pronunciation.analyze({
        targetText,
        attemptAudioUri,
        previous,
      });
      if (!this.isEpochCurrent(epoch)) return undefined;
      this.dependencies.session.patchTurn(turnId, result);
      if (!previous) {
        this.pendingPronunciationTurnId = turnId;
        if (this.state.phase === "idle") {
          this.dependencies.session.setVoicePhase("feedback");
          this.pendingPronunciationTurnId = undefined;
        }
      }
      return result.pronunciation;
    } catch (error) {
      if (this.isEpochCurrent(epoch)) {
        this.dependencies.logger.warn("pronunciation analysis failed", error);
      }
      return undefined;
    }
  }

  private settleReply(run: ResponseRun, successfulRetry: boolean): void {
    if (!this.responseRuns.complete(run.turnId, run.token)) return;
    this.responseQueue = undefined;
    this.dependencies.session.setStreaming(false);
    this.transition("resuming");
    this.publish({
      ownership: EMPTY_OWNERSHIP,
    });
    if (successfulRetry) {
      this.dependencies.session.setVoicePhase("success");
      this.dependencies.haptics.success();
      const epoch = this.eventGeneration;
      this.clearSettleTimer();
      this.settleTimer = this.dependencies.clock.setTimer(() => {
        this.settleTimer = undefined;
        if (!this.isEpochCurrent(epoch) || this.state.phase !== "resuming")
          return;
        if (this.dependencies.session.snapshot().voice.phase === "success") {
          this.dependencies.session.setVoicePhase("idle");
        }
        this.transition("idle");
        if (this.state.handsFreeActive) void this.startListening();
      }, 1_400);
      return;
    }
    if (this.pendingPronunciationTurnId) {
      this.pendingPronunciationTurnId = undefined;
      this.dependencies.session.setVoicePhase("feedback");
    } else {
      this.dependencies.session.setVoicePhase("idle");
    }
    if (this.state.handsFreeActive) {
      void this.startListening();
    } else {
      this.transition("idle");
    }
  }

  private async cancelResponse(reason: string): Promise<void> {
    const interruptedTurnId = this.responseRuns.invalidate();
    if (interruptedTurnId) {
      this.dependencies.session.patchTurn(interruptedTurnId, {
        streaming: false,
        interrupted: true,
      });
    }
    const queue = this.responseQueue;
    this.responseQueue = undefined;
    await Promise.allSettled([
      queue?.stop() ?? Promise.resolve(),
      this.dependencies.audio.stop(),
    ]);
    this.dependencies.session.setStreaming(false);
    this.publish({
      ownership: { ...EMPTY_OWNERSHIP, retry: this.state.ownership.retry },
    });
    this.dependencies.telemetry(
      "conversation_resources_released",
      this.dependencies.session.snapshot().traceContext,
      { reason },
    );
  }

  private reportSpeechFailure(
    error: unknown,
    stage: "start" | "final",
    trace: VoiceTraceContext,
  ): void {
    const failure = this.dependencies.classifyError(error);
    this.dependencies.telemetry(
      "stt_ui_failure",
      trace,
      {
        stage,
        failureKind: failure,
        errorName: this.dependencies.errorName(error),
      },
      "error",
    );
    this.dependencies.haptics.fail();
    const voiceFailure =
      failure === "permissionDenied"
        ? "permissionDenied"
        : failure === "audioInterruption"
          ? "audioInterruption"
          : failure === "network"
            ? "network"
            : "sttFailure";
    this.resumeListening = failure === "audioInterruption";
    this.enterRecovery(voiceFailure);
  }

  private enterRecovery(
    failure:
      | "permissionDenied"
      | "network"
      | "sttFailure"
      | "providerFailure"
      | "providerTimeout"
      | "audioInterruption"
      | "playbackFailure",
    semantic?: "silence",
  ): void {
    if (this.state.phase !== "recovery") {
      if (LEGAL_TRANSITIONS[this.state.phase].includes("recovery")) {
        this.transition("recovery");
      } else {
        return;
      }
    }
    this.dependencies.session.setRecording(false);
    this.dependencies.session.setStreaming(false);
    this.dependencies.session.setVoice(
      voiceError(semantic === "silence" ? "silence" : failure),
    );
    this.publish({
      ownership: {
        ...EMPTY_OWNERSHIP,
        retry: this.failedReply?.assistantTurnId ?? null,
      },
    });
  }

  private scheduleTranscriptEndpoint(
    token: number,
    epoch: number,
    signal: EndpointSignal,
    transcript = "",
  ): void {
    this.scheduleEndpoint(
      token,
      epoch,
      endpointDelayMs(signal, transcript),
      "transcript-silence",
    );
  }

  private scheduleEndpoint(
    token: number,
    epoch: number,
    delayMs: number,
    reason: "initial-silence" | "audio-silence" | "transcript-silence",
  ): void {
    if (this.endpointTimer !== undefined) {
      this.dependencies.clock.clearTimer(this.endpointTimer);
    }
    this.endpointTimer = this.dependencies.clock.setTimer(() => {
      this.endpointTimer = undefined;
      if (!this.isCaptureCurrent(token, epoch)) return;
      this.dependencies.telemetry(
        "hands_free_endpoint_detected",
        { sessionId: this.sessionId, turnId: this.capture?.traceTurnId },
        { reason, delayMs },
      );
      void this.stopListening(reason);
    }, delayMs);
  }

  private scheduleUtteranceLimit(token: number, epoch: number): void {
    if (this.utteranceLimitTimer !== undefined) {
      this.dependencies.clock.clearTimer(this.utteranceLimitTimer);
    }
    this.utteranceLimitTimer = this.dependencies.clock.setTimer(() => {
      this.utteranceLimitTimer = undefined;
      if (!this.isCaptureCurrent(token, epoch)) return;
      this.dependencies.telemetry(
        "hands_free_endpoint_detected",
        { sessionId: this.sessionId, turnId: this.capture?.traceTurnId },
        {
          reason: "utterance-limit",
          delayMs: HANDS_FREE_ENDPOINT.maximumUtteranceMs,
        },
        "warn",
      );
      void this.stopListening("utterance-limit");
    }, HANDS_FREE_ENDPOINT.maximumUtteranceMs);
  }

  private clearCaptureTimers(): void {
    if (this.endpointTimer !== undefined) {
      this.dependencies.clock.clearTimer(this.endpointTimer);
      this.endpointTimer = undefined;
    }
    if (this.utteranceLimitTimer !== undefined) {
      this.dependencies.clock.clearTimer(this.utteranceLimitTimer);
      this.utteranceLimitTimer = undefined;
    }
  }

  private async failActiveCapture(
    token: number,
    epoch: number,
    error: unknown,
  ): Promise<void> {
    if (!this.isCaptureCurrent(token, epoch)) return;
    const capture = this.capture;
    if (!capture) return;
    ++this.eventGeneration;
    this.capture = undefined;
    this.clearCaptureTimers();
    this.dependencies.session.setRecording(false);
    this.publish({
      ownership: EMPTY_OWNERSHIP,
    });
    await capture.ready.then((handle) => handle.cancel()).catch(() => {});
    if (this.dependencies.classifyError(error) === "noSpeech") {
      this.transition("endpoint");
      await this.handleNoSpeech("native-endpoint", capture.traceTurnId);
      return;
    }
    this.reportSpeechFailure(error, "final", {
      sessionId: this.sessionId,
      turnId: capture.traceTurnId,
    });
  }

  private async handleNoSpeech(
    reason: string,
    traceTurnId: string,
  ): Promise<void> {
    this.capture = undefined;
    this.dependencies.session.setRecording(false);
    this.publish({
      draftTranscript: "",
      draftAudioUri: undefined,
      ownership: EMPTY_OWNERSHIP,
    });
    this.dependencies.telemetry(
      "hands_free_no_speech",
      { sessionId: this.sessionId, turnId: traceTurnId },
      { reason, automaticRetry: this.state.handsFreeActive },
    );
    this.dependencies.session.setVoicePhase("idle", {
      interimTranscript: "",
      message: this.state.handsFreeActive
        ? "No speech yet. Koe is still listening."
        : undefined,
    });
    if (this.state.phase === "endpoint" || this.state.phase === "finalizing") {
      this.transition("idle");
    }
    if (!this.state.handsFreeActive || this.disposed) return;
    const epoch = this.eventGeneration;
    this.endpointTimer = this.dependencies.clock.setTimer(() => {
      this.endpointTimer = undefined;
      if (
        this.disposed ||
        !this.state.handsFreeActive ||
        !this.isEpochCurrent(epoch) ||
        this.state.phase !== "idle"
      )
        return;
      void this.startListening();
    }, HANDS_FREE_ENDPOINT.noSpeechRetryMs);
  }

  private updateLatency(
    latency: VoiceLatency,
    stage: keyof VoiceLatency,
  ): void {
    this.dependencies.session.setLatency(latency);
    this.dependencies.telemetry(
      "voice_latency",
      this.dependencies.session.snapshot().traceContext,
      { stage, valueMs: latency[stage] },
    );
  }

  private isCaptureCurrent(
    token: number,
    epoch: number,
    allowedPhase: ConversationPhase = "listening",
  ): boolean {
    return (
      !this.disposed &&
      this.capture?.token === token &&
      this.eventGeneration === epoch &&
      this.state.phase === allowedPhase
    );
  }

  private isEpochCurrent(epoch: number): boolean {
    return !this.disposed && this.eventGeneration === epoch;
  }

  private isPhase(phase: ConversationPhase): boolean {
    return this.state.phase === phase;
  }

  private transition(next: ConversationPhase): void {
    if (this.state.phase === next) return;
    if (!LEGAL_TRANSITIONS[this.state.phase].includes(next)) {
      throw new Error(
        `Illegal conversation transition: ${this.state.phase} -> ${next}`,
      );
    }
    this.publish({ phase: next });
  }

  private publish(patch: Partial<ConversationEngineState>): void {
    this.state = {
      ...this.state,
      ...patch,
      ownership: patch.ownership ?? this.state.ownership,
    };
    for (const listener of this.listeners) listener();
  }

  private clearSettleTimer(): void {
    if (this.settleTimer === undefined) return;
    this.dependencies.clock.clearTimer(this.settleTimer);
    this.settleTimer = undefined;
  }

  private cancelPendingEnrichment(reason: string): void {
    if (!this.pendingEnrichment.size) return;
    const pendingCount = this.pendingEnrichment.size;
    for (const enrichment of this.pendingEnrichment) enrichment.cancel();
    this.pendingEnrichment.clear();
    this.dependencies.telemetry(
      "conversation_enrichment_cancelled",
      this.dependencies.session.snapshot().traceContext,
      { reason, pendingCount },
      "warn",
    );
  }
}
