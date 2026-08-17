import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import type { ConversationResult } from "../services/llm";
import type { PronunciationFeedback } from "../services/pitch";
import type { ChatTurn } from "../stores/useSession";
import { INITIAL_VOICE_LIFECYCLE, type VoiceLifecycle } from "./lifecycle";
import {
  ConversationEngine,
  RecordedAudioInjectionUnavailableError,
  type ConversationDependencies,
  type ConversationPhase,
  type ConversationSessionSnapshot,
  type TranscriptInputEvent,
} from "./conversationEngine";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

const EMPTY_FEEDBACK = {
  corrections: {
    particles: [],
    register: { consistent: true },
    other: [],
  },
  translations: {},
};

function result(
  fullText: string,
  feedback: ConversationResult["feedback"] = Promise.resolve(EMPTY_FEEDBACK),
): ConversationResult {
  return { fullText, feedback };
}

function reply(
  text: string,
  options: {
    streamedAudio?: boolean;
    feedback?: ConversationResult["feedback"];
  } = {},
): ReturnType<ConversationDependencies["replyStream"]> {
  return (async function* () {
    yield { type: "text" as const, text };
    if (options.streamedAudio) {
      yield {
        type: "audio" as const,
        audioBase64: "AAAAAA==",
        encoding: "pcm_s16le" as const,
        sampleRate: 48_000,
        channels: 1,
        byteCount: 4,
      };
    }
    return result(text, options.feedback);
  })();
}

function encodedReply(text: string) {
  return (async function* () {
    yield { type: "text" as const, text };
    yield {
      type: "audio-file" as const,
      audioBase64: "//PE", // The service contract validates before the engine.
      encoding: "mp3" as const,
      sampleRate: 24_000,
      channels: 1,
      byteCount: 3,
    };
    return result(text);
  })();
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
  assert.fail(
    "condition did not settle within the deterministic microtask budget",
  );
}

class FakeClock {
  nowMs = 1_000;
  private nextTimer = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();

  readonly now = () => this.nowMs;

  readonly setTimer = (callback: () => void, delayMs: number): number => {
    const id = ++this.nextTimer;
    this.timers.set(id, { at: this.nowMs + delayMs, callback });
    return id;
  };

  readonly clearTimer = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  get pendingTimerCount(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    this.nowMs += ms;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= this.nowMs)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) return;
      this.timers.delete(due[0]);
      due[1].callback();
    }
  }
}

type Harness = ReturnType<typeof createHarness>;

function createHarness(
  options: {
    intro?: string;
    recordedInput?: boolean;
    retainReplyRequests?: boolean;
  } = {},
) {
  const clock = new FakeClock();
  let idCounter = 0;
  let replyFactory: ConversationDependencies["replyStream"] = () =>
    reply("default reply", { streamedAudio: true });
  const replyRequests: Parameters<
    ConversationDependencies["replyStream"]
  >[0][] = [];
  let replyRequestCount = 0;
  const transcriptInputs: Array<{
    onEvent: (event: TranscriptInputEvent) => void;
    onAudioEnergy: (energy: number) => void;
  }> = [];
  let speechResult = {
    fullText: "",
    durationMs: 600,
    audioUri: "file:///captured.m4a",
  };
  let speechStartError: Error | undefined;
  let speechStopError: Error | undefined;
  let speechCancelled = 0;
  let speechStopped = 0;
  let activeSpeechHandles = 0;
  let recordedText = "injected turn";
  let recordedError: Error | undefined;
  const recordedRequests: Array<{
    uri: string;
    filename?: string;
    mimeType?: string;
  }> = [];
  let audioStopped = 0;
  let queueCreated = 0;
  let queueFinished = 0;
  let queueStopped = 0;
  let activeQueues = 0;
  let maximumActiveQueues = 0;
  let playbackBehavior:
    | "complete"
    | "fail-enqueue"
    | "fail-finish"
    | "callback-failure"
    | "hang" = "complete";
  let ended = 0;
  let closeoutPrepared = 0;
  const writes: Array<{ kind: "add" | "patch"; turnId: string }> = [];
  const telemetry: string[] = [];
  const savedAudio: Array<{ cacheKey: string; format: string }> = [];
  const synthesizedTexts: string[] = [];
  const playedAudioUris: string[] = [];
  const recordingDuringPlayback: boolean[] = [];
  let synthesizeUri = (text: string) => `file:///tts-${text}.mp3`;
  const state: ConversationSessionSnapshot = {
    id: null,
    turns: [],
    isRecording: false,
    isStreaming: false,
    voice: INITIAL_VOICE_LIFECYCLE,
    latency: {},
    traceContext: {},
    closeout: null,
  };

  const setVoicePhase: ConversationDependencies["session"]["setVoicePhase"] = (
    phase,
    patch = {},
  ) => {
    state.voice = {
      ...state.voice,
      errorKind: undefined,
      message: undefined,
      recovery: undefined,
      ...patch,
      phase,
    };
  };

  const dependencies: ConversationDependencies = {
    speechInput: {
      start: async ({ onEvent, onAudioEnergy }) => {
        if (speechStartError) throw speechStartError;
        transcriptInputs.push({ onEvent, onAudioEnergy });
        activeSpeechHandles += 1;
        let active = true;
        const release = () => {
          if (!active) return;
          active = false;
          activeSpeechHandles -= 1;
        };
        return {
          stop: async () => {
            speechStopped += 1;
            release();
            if (speechStopError) throw speechStopError;
            return speechResult;
          },
          cancel: async () => {
            speechCancelled += 1;
            release();
          },
        };
      },
    },
    recordedSpeechInput:
      options.recordedInput === false
        ? undefined
        : {
            transcribe: async (input) => {
              recordedRequests.push(input);
              if (recordedError) throw recordedError;
              const format = input.filename?.endsWith(".mp3")
                ? "mp3"
                : input.filename?.endsWith(".wav")
                  ? "wav"
                  : "m4a";
              return {
                text: recordedText,
                audioUri: input.uri,
                metadata: {
                  format,
                  byteCount: 4_096,
                  sampleRate: 16_000,
                  channels: 1,
                  durationMs: 600,
                },
              };
            },
          },
    replyStream: (request) => {
      replyRequestCount += 1;
      if (options.retainReplyRequests !== false) replyRequests.push(request);
      return replyFactory(request);
    },
    audio: {
      createQueue: (queueOptions) => {
        queueCreated += 1;
        activeQueues += 1;
        maximumActiveQueues = Math.max(maximumActiveQueues, activeQueues);
        const gate = deferred<void>();
        let settled = false;
        let started = false;
        const startPlayback = () => {
          if (started) return;
          started = true;
          recordingDuringPlayback.push(state.isRecording);
          queueOptions.onStarted();
        };
        const release = () => {
          if (settled) return;
          settled = true;
          activeQueues -= 1;
          gate.resolve();
        };
        return {
          enqueue: async () => {
            if (playbackBehavior === "fail-enqueue") {
              const error = new Error("invalid encoded audio");
              error.name = "AudioContractError";
              throw error;
            }
          },
          finish: async () => {
            queueFinished += 1;
            if (playbackBehavior === "fail-finish") {
              release();
              const error = new Error("playback queue failed");
              error.name = "AudioPlaybackError";
              throw error;
            }
            startPlayback();
            if (playbackBehavior === "callback-failure") {
              const error = new Error("player status failed");
              error.name = "AudioPlaybackError";
              queueOptions.onError(error);
              release();
              return;
            }
            if (playbackBehavior === "hang") {
              await gate.promise;
              return;
            }
            queueOptions.onCaptured(
              `file:///reply-${queueOptions.captureKey}.wav`,
            );
            queueOptions.onFinished();
            release();
          },
          stop: async () => {
            queueStopped += 1;
            release();
          },
        };
      },
      save: async (_audioBase64, cacheKey, format) => {
        savedAudio.push({ cacheKey, format });
        return `file:///${cacheKey}.${format}`;
      },
      synthesize: async (text) => {
        synthesizedTexts.push(text);
        return { audioUri: synthesizeUri(text) };
      },
      play: async (audioUri, playbackOptions) => {
        playedAudioUris.push(audioUri);
        recordingDuringPlayback.push(state.isRecording);
        playbackOptions.onStarted?.();
        playbackOptions.onFinished?.();
      },
      stop: async () => {
        audioStopped += 1;
      },
    },
    pronunciation: {
      analyze: async ({ targetText, previous }) => ({
        referenceAudioUri:
          previous?.referenceAudioUri ?? "file:///reference.wav",
        pronunciation: {
          targetText,
          retry: previous
            ? { targetImproved: true, targetScoreDelta: 8 }
            : undefined,
        } as PronunciationFeedback,
      }),
    },
    session: {
      snapshot: () => state,
      start: async (sessionId) => {
        state.id = sessionId;
        state.traceContext = { sessionId };
      },
      addTurn: (turn) => {
        state.turns = [...state.turns, { ...turn }].sort(
          (left, right) => left.createdAt - right.createdAt,
        );
        writes.push({ kind: "add", turnId: turn.id });
      },
      patchTurn: (turnId, patch) => {
        state.turns = state.turns.map((turn) =>
          turn.id === turnId ? { ...turn, ...patch } : turn,
        );
        writes.push({ kind: "patch", turnId });
      },
      appendAssistantText: (turnId, chunk) => {
        state.turns = state.turns.map((turn) =>
          turn.id === turnId
            ? { ...turn, textJa: `${turn.textJa}${chunk}` }
            : turn,
        );
        writes.push({ kind: "patch", turnId });
      },
      setRecording: (isRecording) => {
        state.isRecording = isRecording;
      },
      setStreaming: (isStreaming) => {
        state.isStreaming = isStreaming;
      },
      setVoice: (voice: VoiceLifecycle) => {
        state.voice = voice;
      },
      setVoicePhase,
      setInterimTranscript: (interimTranscript) => {
        state.voice = {
          ...state.voice,
          phase: interimTranscript ? "interimTranscript" : "listening",
          interimTranscript,
        };
      },
      setLatency: (latency) => {
        state.latency = latency;
      },
      setTraceContext: (trace) => {
        state.traceContext = { sessionId: state.id ?? undefined, ...trace };
      },
      prepareCloseout: async () => {
        closeoutPrepared += 1;
        state.closeout = { prepared: true };
        return state.closeout;
      },
      end: async () => {
        ended += 1;
      },
    },
    clock,
    ids: { next: () => `id-${++idCounter}` },
    telemetry: (event) => telemetry.push(event),
    logger: { warn: () => undefined },
    classifyError: (error) => {
      if (!(error instanceof Error)) return "network";
      if (error.name === "AbortError") return "cancelled";
      if (error.name === "PermissionDeniedError") return "permissionDenied";
      if (error.name === "NoSpeechError") return "noSpeech";
      if (error.name === "AudioInterruptionError") return "audioInterruption";
      if (error.name === "ProviderTimeoutError") return "providerTimeout";
      if (error.name === "ProviderStreamError") return "providerFailure";
      if (error.name === "AudioContractError") return "audioContract";
      if (
        error.name === "AudioPlaybackError" ||
        error.name === "NoPlayableAudioError"
      )
        return "playbackFailure";
      return "network";
    },
    errorName: (error) =>
      error instanceof Error ? error.name : "UnknownError",
    haptics: {
      tap: () => undefined,
      success: () => undefined,
      fail: () => undefined,
    },
    openSettings: async () => undefined,
    shouldAutoSend: () => true,
  };

  const engine = new ConversationEngine(
    "session-1",
    options.intro,
    dependencies,
  );
  return {
    engine,
    clock,
    state,
    writes,
    telemetry,
    savedAudio,
    synthesizedTexts,
    playedAudioUris,
    recordingDuringPlayback,
    transcriptInputs,
    recordedRequests,
    replyRequests,
    get speechCancelled() {
      return speechCancelled;
    },
    get speechStopped() {
      return speechStopped;
    },
    get activeSpeechHandles() {
      return activeSpeechHandles;
    },
    get audioStopped() {
      return audioStopped;
    },
    get queueCreated() {
      return queueCreated;
    },
    get queueFinished() {
      return queueFinished;
    },
    get queueStopped() {
      return queueStopped;
    },
    get activeQueues() {
      return activeQueues;
    },
    get maximumActiveQueues() {
      return maximumActiveQueues;
    },
    get replyRequestCount() {
      return replyRequestCount;
    },
    get ended() {
      return ended;
    },
    get closeoutPrepared() {
      return closeoutPrepared;
    },
    setReplyFactory(factory: ConversationDependencies["replyStream"]) {
      replyFactory = factory;
    },
    setPlaybackBehavior(behavior: typeof playbackBehavior) {
      playbackBehavior = behavior;
    },
    setSpeechResult(next: typeof speechResult) {
      speechResult = next;
    },
    setSpeechStartError(error: Error | undefined) {
      speechStartError = error;
    },
    setSpeechStopError(error: Error | undefined) {
      speechStopError = error;
    },
    setRecordedError(error: Error | undefined) {
      recordedError = error;
    },
    setSynthesizeUri(factory: (text: string) => string) {
      synthesizeUri = factory;
    },
    injectRecorded(text: string, extension: "mp3" | "m4a" | "wav" = "m4a") {
      recordedText = text;
      return engine.injectRecordedAudio({
        uri: `file:///fixture.${extension}`,
        filename: `fixture.${extension}`,
      });
    },
  };
}

function turnByRole(
  harness: Harness,
  role: ChatTurn["role"],
  index = 0,
): ChatTurn {
  return harness.state.turns.filter((turn) => turn.role === role)[index]!;
}

test("one start action sustains short and rapid turns without recording tutor playback", async () => {
  const harness = createHarness();
  harness.setReplyFactory(({ userTurn }) =>
    reply(`reply:${userTurn}`, { streamedAudio: true }),
  );

  await harness.engine.startHandsFree();
  assert.equal(harness.engine.getState().handsFreeActive, true);
  assert.equal(harness.engine.getState().phase, "listening");

  harness.transcriptInputs[0]!.onEvent({
    type: "final",
    text: "はい",
    confidence: 0.99,
  });
  harness.clock.advance(300);
  await waitFor(() => harness.transcriptInputs.length === 2);

  assert.equal(harness.engine.getState().phase, "listening");
  assert.equal(harness.engine.getState().ownership.audioSession, "microphone");

  harness.transcriptInputs[1]!.onEvent({
    type: "final",
    text: "すぐ続けます",
    confidence: 0.98,
  });
  harness.clock.advance(300);
  await waitFor(() => harness.transcriptInputs.length === 3);

  assert.deepEqual(
    harness.state.turns.map((turn) => [turn.role, turn.textJa]),
    [
      ["user", "はい"],
      ["assistant", "reply:はい"],
      ["user", "すぐ続けます"],
      ["assistant", "reply:すぐ続けます"],
    ],
  );
  assert.deepEqual(harness.recordingDuringPlayback, [false, false]);
  assert.equal(harness.state.voice.phase, "listening");
});

test("long speech keeps extending the endpoint and hesitant speech gets a wider pause", async () => {
  const harness = createHarness();
  await harness.engine.startHandsFree();
  const input = harness.transcriptInputs[0]!;

  input.onEvent({
    type: "interim",
    text: "先週の日曜日",
    confidence: 0.7,
  });
  harness.clock.advance(1_200);
  input.onEvent({
    type: "interim",
    text: "先週の日曜日、朝早く起きて川沿いを",
    confidence: 0.76,
  });
  harness.clock.advance(1_200);
  assert.equal(harness.replyRequests.length, 0);
  assert.equal(harness.engine.getState().phase, "listening");

  input.onEvent({
    type: "interim",
    text: "先週の日曜日、えっと…",
    confidence: 0.72,
  });
  harness.clock.advance(2_000);
  assert.equal(harness.replyRequests.length, 0);
  assert.equal(harness.engine.getState().phase, "listening");

  input.onEvent({
    type: "final",
    text: "先週の日曜日、朝早く起きて川沿いを散歩しました",
    confidence: 0.97,
  });
  harness.clock.advance(300);
  await waitFor(() => harness.transcriptInputs.length === 2);

  assert.equal(
    turnByRole(harness, "user").textJa,
    "先週の日曜日、朝早く起きて川沿いを散歩しました",
  );
  assert.equal(harness.engine.getState().phase, "listening");
});

test("no speech and a false start retry quietly while hands-free remains active", async () => {
  const harness = createHarness();
  await harness.engine.startHandsFree();

  harness.clock.advance(8_000);
  await waitFor(() => harness.engine.getState().phase === "idle");
  assert.equal(harness.state.voice.errorKind, undefined);
  assert.match(harness.state.voice.message ?? "", /still listening/i);
  harness.clock.advance(350);
  await waitFor(() => harness.transcriptInputs.length === 2);

  harness.clock.advance(150);
  harness.transcriptInputs[1]!.onEvent({ type: "endpoint" });
  await waitFor(() => harness.engine.getState().phase === "idle");
  harness.clock.advance(350);
  await waitFor(() => harness.transcriptInputs.length === 3);

  assert.equal(harness.state.turns.length, 0);
  assert.equal(harness.engine.getState().phase, "listening");
  assert.ok(harness.telemetry.includes("hands_free_no_speech"));
});

test("a recognizer no-speech rejection follows the same quiet retry path", async () => {
  const harness = createHarness();
  const error = new Error("nothing recognized");
  error.name = "NoSpeechError";
  harness.setSpeechStopError(error);

  await harness.engine.startHandsFree();
  harness.clock.advance(8_000);
  await waitFor(() => harness.engine.getState().phase === "idle");

  assert.equal(harness.state.voice.errorKind, undefined);
  assert.equal(harness.state.turns.length, 0);
  harness.setSpeechStopError(undefined);
  harness.clock.advance(350);
  await waitFor(() => harness.engine.getState().phase === "listening");
  assert.equal(harness.transcriptInputs.length, 2);
});

test("permission denial pauses truthfully instead of retrying or creating a turn", async () => {
  const harness = createHarness();
  const error = new Error("permission denied");
  error.name = "PermissionDeniedError";
  harness.setSpeechStartError(error);

  await harness.engine.startHandsFree();

  assert.equal(harness.engine.getState().phase, "recovery");
  assert.equal(harness.state.voice.errorKind, "permissionDenied");
  assert.equal(harness.state.voice.recovery, "openSettings");
  assert.equal(harness.state.turns.length, 0);
  assert.equal(harness.state.isRecording, false);

  await harness.engine.interrupt("app");
  harness.setSpeechStartError(undefined);
  await harness.engine.resume();
  assert.equal(harness.engine.getState().phase, "listening");
  assert.equal(harness.state.voice.errorKind, undefined);
  assert.equal(harness.transcriptInputs.length, 1);
});

test("backgrounding before hands-free starts does not invent an interruption", async () => {
  const harness = createHarness();
  await harness.engine.start();

  await harness.engine.interrupt("app");
  await harness.engine.resume();

  assert.equal(harness.engine.getState().phase, "idle");
  assert.equal(harness.state.voice.errorKind, undefined);
  assert.equal(harness.transcriptInputs.length, 0);
});

test("intentional barge-in transfers playback to listening without an error state", async () => {
  const harness = createHarness();
  const gate = deferred<void>();
  harness.setReplyFactory(() =>
    (async function* () {
      await gate.promise;
      yield { type: "text" as const, text: "late reply" };
      return result("late reply");
    })(),
  );
  await harness.engine.startHandsFree();
  harness.transcriptInputs[0]!.onEvent({
    type: "final",
    text: "first",
    confidence: 1,
  });
  harness.clock.advance(300);
  await waitFor(() => harness.replyRequests.length === 1);
  const assistant = turnByRole(harness, "assistant");

  await harness.engine.bargeIn();

  assert.equal(harness.replyRequests[0]!.signal.aborted, true);
  assert.equal(turnByRole(harness, "assistant").id, assistant.id);
  assert.equal(turnByRole(harness, "assistant").interrupted, true);
  assert.equal(harness.engine.getState().phase, "listening");
  assert.notEqual(harness.state.voice.phase, "recoverableError");
  gate.resolve();
});

test("microphone endpoint/final events and injected files share the deterministic multi-turn path", async () => {
  const harness = createHarness({ intro: "1" });
  harness.setReplyFactory(() => reply("返事です。", { streamedAudio: true }));
  const phases: ConversationPhase[] = [];
  harness.engine.subscribe(() => phases.push(harness.engine.getState().phase));

  await harness.engine.start();
  await harness.engine.startListening();
  harness.transcriptInputs[0]!.onEvent({
    type: "final",
    text: "一つ目",
    confidence: 0.98,
  });
  harness.clock.advance(600);
  await harness.engine.stopListening();
  await harness.injectRecorded("二つ目");
  await flush();

  assert.deepEqual(
    harness.state.turns.map((turn) => [turn.role, turn.textJa]),
    [
      ["user", "一つ目"],
      ["assistant", "返事です。"],
      ["user", "二つ目"],
      ["assistant", "返事です。"],
    ],
  );
  assert.ok(phases.includes("endpoint"));
  assert.ok(phases.includes("finalizing"));
  assert.ok(phases.includes("understanding"));
  assert.ok(phases.includes("speaking"));
  assert.ok(phases.includes("resuming"));
  assert.equal(harness.engine.getState().phase, "idle");
  assert.deepEqual(harness.engine.getState().ownership, {
    audioSession: "none",
    microphone: null,
    providerRequest: null,
    playbackQueue: null,
    retry: null,
  });
  assert.ok(harness.writes.filter((write) => write.kind === "add").length >= 4);
  assert.ok(harness.writes.some((write) => write.kind === "patch"));
});

test("a validated provider MP3 is persisted and played without a second synthesis", async () => {
  const harness = createHarness();
  harness.setReplyFactory(() => encodedReply("実際の音声です。"));

  await harness.injectRecorded("音声で答えてください");
  await flush();

  const assistant = turnByRole(harness, "assistant");
  assert.equal(assistant.textJa, "実際の音声です。");
  assert.match(assistant.audioUri ?? "", /provider-.*\.mp3$/);
  assert.equal(harness.savedAudio.length, 1);
  assert.deepEqual(harness.synthesizedTexts, []);
  assert.deepEqual(harness.playedAudioUris, [assistant.audioUri]);
  assert.equal(harness.queueCreated, 0);
  assert.equal(harness.engine.getState().phase, "idle");
});

test("text-only provider output deliberately falls back to standalone speech", async () => {
  const harness = createHarness();
  harness.setReplyFactory(() => reply("音声を作り直します。"));

  await harness.injectRecorded("続けてください");
  await flush();

  const assistant = turnByRole(harness, "assistant");
  assert.deepEqual(harness.synthesizedTexts, ["音声を作り直します。"]);
  assert.deepEqual(harness.playedAudioUris, [assistant.audioUri]);
  assert.ok(harness.telemetry.includes("response_fallback"));
  assert.equal(harness.state.voice.errorKind, undefined);
  assert.equal(harness.engine.getState().phase, "idle");
});

test("text without streamed or fallback audio remains a specific recoverable failure", async () => {
  const harness = createHarness();
  harness.setReplyFactory(() => reply("文字だけの応答です。"));
  harness.setSynthesizeUri(() => "");

  await harness.injectRecorded("音声はありますか");
  await flush();

  const assistant = turnByRole(harness, "assistant");
  assert.equal(assistant.textJa, "文字だけの応答です。");
  assert.equal(assistant.audioUri, undefined);
  assert.equal(harness.engine.getState().phase, "recovery");
  assert.equal(harness.state.voice.errorKind, "playbackFailure");
  assert.equal(harness.state.voice.recovery, "retryResponse");
});

test("provider timeout remains a specific retryable state without silent success", async () => {
  const harness = createHarness();
  harness.setReplyFactory(() =>
    (async function* () {
      const error = new Error("provider response timed out");
      error.name = "ProviderTimeoutError";
      throw error;
    })(),
  );

  await harness.injectRecorded("時間切れを確認します");
  await flush();

  const assistant = turnByRole(harness, "assistant");
  assert.equal(assistant.streaming, false);
  assert.equal(assistant.audioUri, undefined);
  assert.equal(harness.engine.getState().phase, "recovery");
  assert.equal(harness.state.voice.errorKind, "providerTimeout");
  assert.equal(harness.state.voice.recovery, "retryResponse");
  assert.equal(harness.playedAudioUris.length, 0);
});

test("saved reply replay uses the persisted audio without changing turn state", async () => {
  const harness = createHarness();
  harness.setReplyFactory(() => encodedReply("保存した返事です。"));
  await harness.injectRecorded("保存してください");
  const assistantBefore = { ...turnByRole(harness, "assistant") };

  await harness.engine.playAudio(assistantBefore.audioUri!);

  assert.equal(harness.playedAudioUris.at(-1), assistantBefore.audioUri);
  assert.deepEqual(turnByRole(harness, "assistant"), assistantBefore);
  assert.equal(harness.engine.getState().phase, "idle");
});

test("MP3, M4A, and WAV recorded files produce equivalent canonical turns", async () => {
  for (const format of ["mp3", "m4a", "wav"] as const) {
    const harness = createHarness();
    harness.setReplyFactory(() =>
      reply("同じ返事です。", { streamedAudio: true }),
    );

    await harness.injectRecorded("明日は京都へ行きます。", format);
    await flush();

    const user = turnByRole(harness, "user");
    assert.equal(user.textJa, "明日は京都へ行きます。");
    assert.equal(user.audioUri, `file:///fixture.${format}`);
    assert.equal(turnByRole(harness, "assistant").textJa, "同じ返事です。");
    assert.equal(harness.recordedRequests.length, 1);
    assert.ok(harness.telemetry.includes("recorded_audio_injection_started"));
    assert.ok(harness.telemetry.includes("recorded_audio_injection_completed"));
  }
});

test("recorded-file seam rejects calls when the Release adapter omits it", async () => {
  const harness = createHarness({ recordedInput: false });
  await assert.rejects(
    () =>
      harness.engine.injectRecordedAudio({
        uri: "file:///release-bypass.wav",
        filename: "release-bypass.wav",
      }),
    RecordedAudioInjectionUnavailableError,
  );
  assert.equal(harness.engine.getState().phase, "idle");
  assert.equal(harness.replyRequests.length, 0);
  assert.equal(harness.state.turns.length, 0);
});

test("a newer turn cancels the old run and rejects its stale stream events", async () => {
  const harness = createHarness();
  const gate = deferred<void>();
  let request = 0;
  harness.setReplyFactory(() => {
    request += 1;
    if (request === 2) return reply("fresh");
    return (async function* () {
      await gate.promise;
      yield { type: "text" as const, text: "STALE" };
      return result("STALE");
    })();
  });

  const first = harness.injectRecorded("first");
  await waitFor(() =>
    harness.state.turns.some((turn) => turn.role === "assistant"),
  );
  const firstAssistant = turnByRole(harness, "assistant");
  await harness.injectRecorded("second");
  gate.resolve();
  await first;

  const assistants = harness.state.turns.filter(
    (turn) => turn.role === "assistant",
  );
  assert.equal(firstAssistant.id, assistants[0]!.id);
  assert.equal(assistants[0]!.interrupted, true);
  assert.equal(assistants[0]!.textJa.includes("STALE"), false);
  assert.equal(assistants[1]!.textJa, "fresh");
  assert.ok(harness.telemetry.includes("response_cancelled"));
});

test("audio interruption cancels capture, rejects late transcripts, and cleanly resumes", async () => {
  const harness = createHarness();
  await harness.engine.startHandsFree();
  const firstInput = harness.transcriptInputs[0]!;
  firstInput.onEvent({ type: "interim", text: "before", confidence: 0.7 });

  await harness.engine.interrupt("audio");
  firstInput.onEvent({ type: "final", text: "late", confidence: 1 });

  assert.equal(harness.engine.getState().phase, "recovery");
  assert.equal(harness.engine.getState().draftTranscript, "before");
  assert.equal(harness.state.voice.recovery, "resume");
  assert.equal(harness.speechCancelled, 1);
  assert.equal(harness.state.isRecording, false);

  await harness.engine.resume();
  assert.equal(harness.engine.getState().phase, "listening");
  assert.equal(harness.transcriptInputs.length, 2);
  assert.equal(harness.state.isRecording, true);
  assert.equal(harness.engine.getState().ownership.audioSession, "microphone");
});

test("ending during an in-flight provider request aborts and persists interruption before ending", async () => {
  const harness = createHarness();
  const gate = deferred<void>();
  harness.setReplyFactory(() =>
    (async function* () {
      await gate.promise;
      yield { type: "text" as const, text: "too late" };
      return result("too late");
    })(),
  );

  const pending = harness.injectRecorded("end now");
  await waitFor(() => harness.replyRequests.length === 1);
  const assistant = turnByRole(harness, "assistant");
  harness.engine.requestEnd();
  assert.equal(harness.replyRequests[0]!.signal.aborted, true);
  gate.resolve();
  await pending;
  await harness.engine.finishEnd();

  assert.equal(harness.engine.getState().phase, "ended");
  assert.equal(harness.ended, 1);
  assert.equal(harness.closeoutPrepared, 1);
  assert.equal(
    harness.state.turns.find((turn) => turn.id === assistant.id)?.interrupted,
    true,
  );
  assert.equal(
    harness.state.turns
      .find((turn) => turn.id === assistant.id)
      ?.textJa.includes("too late"),
    false,
  );
});

test("retry reuses the failed assistant turn with a new response run", async () => {
  const harness = createHarness();
  let attempt = 0;
  harness.setReplyFactory(() => {
    attempt += 1;
    if (attempt === 2) return reply("recovered");
    return (async function* () {
      throw new Error("network down");
    })();
  });

  await harness.injectRecorded("retry me");
  const failedAssistant = turnByRole(harness, "assistant");
  const failedRunId = failedAssistant.responseRunId;
  assert.equal(harness.engine.getState().phase, "recovery");
  assert.equal(harness.state.voice.recovery, "retryResponse");

  await harness.engine.recover();
  const assistants = harness.state.turns.filter(
    (turn) => turn.role === "assistant",
  );
  assert.equal(assistants.length, 1);
  assert.equal(assistants[0]!.id, failedAssistant.id);
  assert.equal(assistants[0]!.textJa, "recovered");
  assert.notEqual(assistants[0]!.responseRunId, failedRunId);
  assert.equal(assistants[0]!.interrupted, false);
  assert.equal(harness.engine.getState().phase, "resuming");
  harness.clock.advance(1_400);
  assert.equal(harness.engine.getState().phase, "idle");
});

test("feedback that resolves after a newer turn is rejected as stale", async () => {
  const harness = createHarness();
  const feedback = deferred<typeof EMPTY_FEEDBACK>();
  let request = 0;
  harness.setReplyFactory(() => {
    request += 1;
    return request === 1
      ? reply("first reply", { feedback: feedback.promise })
      : reply("second reply");
  });

  await harness.injectRecorded("first");
  const firstUser = turnByRole(harness, "user");
  await harness.injectRecorded("second");
  feedback.resolve({
    ...EMPTY_FEEDBACK,
    translations: { user: "stale translation", tutor: "stale tutor" },
  });
  await flush();

  assert.equal(
    harness.state.turns.find((turn) => turn.id === firstUser.id)?.textEn,
    undefined,
  );
});

type SoakScenarioArtifact = {
  name: string;
  status: "passed";
  metrics: Record<string, number | string | boolean>;
  invariants: string[];
};

const soakArtifact = {
  schemaVersion: 1,
  suite: "koe-voice-soak",
  target: "deterministic conversation-engine boundary",
  scenarios: [] as SoakScenarioArtifact[],
};

function recordSoakScenario(
  name: string,
  metrics: SoakScenarioArtifact["metrics"],
  invariants: string[],
): void {
  soakArtifact.scenarios.push({ name, status: "passed", metrics, invariants });
}

function assertNoOwnedResources(harness: Harness): void {
  const diagnostics = harness.engine.getDiagnostics();
  assert.equal(diagnostics.activeResponseRunCount, 0);
  assert.equal(diagnostics.activeCaptureCount, 0);
  assert.equal(diagnostics.activePlaybackQueueCount, 0);
  assert.equal(diagnostics.pendingTimerCount, 0);
  assert.equal(diagnostics.pendingEnrichmentCount, 0);
  assert.equal(harness.clock.pendingTimerCount, 0);
  assert.equal(harness.activeSpeechHandles, 0);
  assert.equal(harness.activeQueues, 0);
  assert.equal(harness.state.isRecording, false);
  assert.equal(harness.state.isStreaming, false);
}

test("a 240-turn varied-length conversation remains ordered, bounded, and resource-clean", async () => {
  const harness = createHarness({ retainReplyRequests: false });
  let responseNumber = 0;
  harness.setReplyFactory(() => {
    responseNumber += 1;
    return reply(`返事 ${responseNumber}`, { streamedAudio: true });
  });
  const utterances = [
    "はい",
    "今日はいい天気ですね。",
    "えっと、先週の日曜日に友達と川沿いを散歩して、それから小さい喫茶店で長い時間話しました。",
    `長い発話 ${"日本語を自然に続けます。".repeat(32)}`,
  ];
  const heapAtStart = process.memoryUsage().heapUsed;
  let peakHeap = heapAtStart;

  for (let index = 0; index < 240; index += 1) {
    harness.clock.advance(5);
    await harness.injectRecorded(
      `${utterances[index % utterances.length]} ${index}`,
    );
    await flush();
    if (index % 20 === 0) {
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    }
    assert.equal(harness.engine.getState().phase, "idle");
    assertNoOwnedResources(harness);
  }

  const ids = harness.state.turns.map((turn) => turn.id);
  assert.equal(harness.state.turns.length, 480);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(harness.replyRequestCount, 240);
  assert.equal(harness.queueCreated, 240);
  assert.equal(harness.queueFinished, 240);
  assert.equal(harness.maximumActiveQueues, 1);
  assert.ok(harness.state.turns.every((turn) => !turn.streaming));
  assert.ok(
    harness.state.turns.every(
      (turn, index) => turn.role === (index % 2 === 0 ? "user" : "assistant"),
    ),
  );
  assert.ok(
    harness.state.turns.every(
      (turn, index, turns) =>
        index === 0 || turn.createdAt >= turns[index - 1]!.createdAt,
    ),
  );
  const heapAtEnd = process.memoryUsage().heapUsed;
  const heapDelta = Math.max(0, heapAtEnd - heapAtStart);
  const heapBytesPerPersistedTurn = Math.round(
    heapDelta / harness.state.turns.length,
  );
  // The complete 480-turn history is deliberately retained. This guards
  // against accidental per-turn retention of entire response histories.
  assert.ok(heapBytesPerPersistedTurn < 200_000);

  recordSoakScenario(
    "240-turn varied utterance soak",
    {
      userTurns: 240,
      persistedTurns: 480,
      replyRequests: harness.replyRequestCount,
      queuesCreated: harness.queueCreated,
      maximumActiveQueues: harness.maximumActiveQueues,
      heapDeltaBytes: heapDelta,
      peakHeapBytes: peakHeap,
      heapBytesPerPersistedTurn,
    },
    [
      "turn IDs stayed unique and user/assistant ordering stayed exact",
      "every assistant turn completed with streaming=false",
      "response run, capture, playback queue, timer, and enrichment counts returned to zero after every turn",
      "at most one playback queue was active",
    ],
  );
});

test("hostile provider, audio, network, lifecycle, and termination timing always settles", async () => {
  const failureCases = [
    ["provider error", "ProviderStreamError", "providerFailure"],
    ["provider timeout", "ProviderTimeoutError", "providerTimeout"],
    ["network loss", "NetworkError", "network"],
    ["rate limit", "RateLimitError", "network"],
    ["invalid encoding", "AudioContractError", "playbackFailure"],
  ] as const;
  let retries = 0;

  for (const [label, errorName, expectedKind] of failureCases) {
    const harness = createHarness();
    harness.setReplyFactory(() =>
      (async function* () {
        const error = new Error(label);
        error.name = errorName;
        throw error;
      })(),
    );
    await harness.injectRecorded(`failure:${label}`);
    assert.equal(harness.engine.getState().phase, "recovery");
    assert.equal(harness.state.voice.errorKind, expectedKind);
    assert.equal(harness.state.voice.recovery, "retryResponse");
    assert.equal(
      harness.state.turns.filter((turn) => turn.role === "user").length,
      1,
    );
    assert.equal(
      harness.state.turns.filter((turn) => turn.role === "assistant").length,
      1,
    );
    assert.equal(harness.engine.getDiagnostics().activeResponseRunCount, 0);
    assert.equal(harness.engine.getDiagnostics().activePlaybackQueueCount, 0);
    assert.equal(harness.activeQueues, 0);
    assert.equal(harness.state.isStreaming, false);

    harness.setReplyFactory(() => reply("recovered", { streamedAudio: true }));
    await harness.engine.recover();
    retries += 1;
    assert.equal(harness.replyRequestCount, 2);
    assert.equal(
      harness.state.turns.filter((turn) => turn.role === "assistant").length,
      1,
    );
    harness.clock.advance(1_400);
    await flush();
    assert.equal(harness.engine.getState().phase, "idle");
    assertNoOwnedResources(harness);
  }

  const emptyAudio = createHarness();
  emptyAudio.setReplyFactory(() => reply("text but no stream audio"));
  emptyAudio.setSynthesizeUri(() => "");
  await emptyAudio.injectRecorded("empty audio");
  assert.equal(emptyAudio.state.voice.errorKind, "playbackFailure");
  assert.equal(emptyAudio.state.voice.recovery, "retryResponse");
  assert.equal(emptyAudio.engine.getDiagnostics().activeResponseRunCount, 0);

  const playbackFailure = createHarness();
  playbackFailure.setPlaybackBehavior("callback-failure");
  await playbackFailure.injectRecorded("playback callback failure");
  assert.equal(playbackFailure.state.voice.errorKind, "playbackFailure");
  assert.equal(playbackFailure.activeQueues, 0);
  assert.equal(playbackFailure.state.isStreaming, false);

  const storagePressure = createHarness();
  const quota = new Error("database or cache is full");
  quota.name = "QuotaExceededError";
  storagePressure.setRecordedError(quota);
  await storagePressure.injectRecorded("storage pressure");
  assert.equal(storagePressure.engine.getState().phase, "recovery");
  assert.equal(storagePressure.state.voice.errorKind, "network");
  assert.equal(storagePressure.state.turns.length, 0);
  assertNoOwnedResources(storagePressure);

  const repeatedBackgrounding = createHarness();
  await repeatedBackgrounding.engine.startHandsFree();
  for (let index = 0; index < 32; index += 1) {
    const staleInput = repeatedBackgrounding.transcriptInputs.at(-1)!;
    staleInput.onEvent({
      type: "interim",
      text: `partial ${index}`,
      confidence: 0.5,
    });
    await repeatedBackgrounding.engine.interrupt("app");
    staleInput.onEvent({
      type: "final",
      text: `stale ${index}`,
      confidence: 1,
    });
    assert.equal(repeatedBackgrounding.activeSpeechHandles, 0);
    assert.equal(
      repeatedBackgrounding.engine.getDiagnostics().pendingTimerCount,
      0,
    );
    await repeatedBackgrounding.engine.resume();
    assert.equal(repeatedBackgrounding.activeSpeechHandles, 1);
    assert.equal(repeatedBackgrounding.state.turns.length, 0);
  }
  await repeatedBackgrounding.engine.pauseHandsFree();
  assertNoOwnedResources(repeatedBackgrounding);

  const repeatedBargeIn = createHarness();
  const bargeInGates: Array<Deferred<void>> = [];
  let bargeInRequest = 0;
  repeatedBargeIn.setReplyFactory(({ userTurn }) => {
    bargeInRequest += 1;
    if (bargeInRequest % 2 === 0) {
      return reply(`fresh:${userTurn}`, { streamedAudio: true });
    }
    const gate = deferred<void>();
    bargeInGates.push(gate);
    return (async function* () {
      await gate.promise;
      yield { type: "text" as const, text: "stale barge-in reply" };
      return result("stale barge-in reply");
    })();
  });
  for (let index = 0; index < 24; index += 1) {
    const interrupted = repeatedBargeIn.injectRecorded(`slow ${index}`);
    await waitFor(() => repeatedBargeIn.replyRequestCount === index * 2 + 1);
    await repeatedBargeIn.injectRecorded(`barge ${index}`);
    bargeInGates[index]!.resolve();
    await interrupted;
    assert.equal(repeatedBargeIn.engine.getState().phase, "idle");
    assertNoOwnedResources(repeatedBargeIn);
  }
  const bargeInAssistants = repeatedBargeIn.state.turns.filter(
    (turn) => turn.role === "assistant",
  );
  assert.equal(bargeInAssistants.length, 48);
  assert.equal(bargeInAssistants.filter((turn) => turn.interrupted).length, 24);
  assert.equal(
    bargeInAssistants.some((turn) => turn.textJa.includes("stale barge-in")),
    false,
  );

  const playbackInterruption = createHarness();
  playbackInterruption.setPlaybackBehavior("hang");
  const interruptedPlayback = playbackInterruption.injectRecorded(
    "background during playback",
  );
  await waitFor(
    () => playbackInterruption.engine.getState().phase === "speaking",
  );
  await playbackInterruption.engine.interrupt("app");
  await interruptedPlayback;
  assert.equal(playbackInterruption.queueStopped, 1);
  assert.equal(playbackInterruption.activeQueues, 0);
  await playbackInterruption.engine.resume();
  assert.equal(playbackInterruption.engine.getState().phase, "idle");
  assertNoOwnedResources(playbackInterruption);

  const endDuringCapture = createHarness();
  await endDuringCapture.engine.startHandsFree();
  await endDuringCapture.engine.endImmediately();
  assert.equal(endDuringCapture.speechCancelled, 1);
  assert.equal(endDuringCapture.engine.getState().phase, "ended");
  assertNoOwnedResources(endDuringCapture);

  const endDuringPlayback = createHarness();
  endDuringPlayback.setPlaybackBehavior("hang");
  const pendingPlayback = endDuringPlayback.injectRecorded(
    "end during playback",
  );
  await waitFor(() => endDuringPlayback.engine.getState().phase === "speaking");
  endDuringPlayback.engine.requestEnd();
  await pendingPlayback;
  await endDuringPlayback.engine.finishEnd();
  assert.equal(endDuringPlayback.queueStopped, 1);
  assert.equal(endDuringPlayback.engine.getState().phase, "ended");
  assertNoOwnedResources(endDuringPlayback);

  const neverFeedback = deferred<typeof EMPTY_FEEDBACK>();
  const endWithPendingFeedback = createHarness();
  endWithPendingFeedback.setReplyFactory(() =>
    reply("audible reply", {
      streamedAudio: true,
      feedback: neverFeedback.promise,
    }),
  );
  await endWithPendingFeedback.injectRecorded("end before feedback");
  assert.equal(
    endWithPendingFeedback.engine.getDiagnostics().pendingEnrichmentCount,
    1,
  );
  await endWithPendingFeedback.engine.endImmediately();
  await flush();
  assert.equal(endWithPendingFeedback.replyRequests[0]!.signal.aborted, true);
  assert.equal(endWithPendingFeedback.engine.getState().phase, "ended");
  assertNoOwnedResources(endWithPendingFeedback);

  const terminatedRoute = createHarness();
  const providerGate = deferred<void>();
  terminatedRoute.setReplyFactory(() =>
    (async function* () {
      await providerGate.promise;
      yield { type: "text" as const, text: "late termination callback" };
      return result("late termination callback");
    })(),
  );
  const terminatedRequest = terminatedRoute.injectRecorded("terminate app");
  await waitFor(() => terminatedRoute.replyRequestCount === 1);
  terminatedRoute.engine.dispose();
  providerGate.resolve();
  await terminatedRequest;
  await flush();
  assert.equal(terminatedRoute.replyRequests[0]!.signal.aborted, true);
  assert.equal(terminatedRoute.engine.getDiagnostics().disposed, true);
  assertNoOwnedResources(terminatedRoute);

  recordSoakScenario(
    "adversarial failure and lifecycle matrix",
    {
      failureKinds: failureCases.length + 3,
      successfulExplicitRetries: retries,
      backgroundForegroundCycles: 32,
      repeatedBargeInCycles: 24,
      playbackInterruptions: 2,
      terminationCases: 3,
      staleTurnsAccepted: 0,
      maximumActiveQueues: Math.max(
        playbackInterruption.maximumActiveQueues,
        endDuringPlayback.maximumActiveQueues,
      ),
    },
    [
      "provider, timeout, network, rate-limit, encoding, empty-audio, playback, and storage-pressure failures exposed concrete recovery states",
      "each explicit response retry reused one assistant turn and attempted exactly once",
      "late recognizer, provider, playback, and feedback callbacks changed no completed or newer turn",
      "background, foreground, end-session, route disposal, and termination released every owned handle and timer",
      "no scenario remained recording, streaming, listening, speaking, or spinning",
    ],
  );

  const artifactDirectory = resolve(".artifacts/voice-soak");
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(
    resolve(artifactDirectory, "engine-summary.json"),
    `${JSON.stringify(soakArtifact, null, 2)}\n`,
  );
});
