import assert from "node:assert/strict";
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
  for (let attempt = 0; attempt < 20; attempt += 1) {
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
  options: { intro?: string; recordedInput?: boolean } = {},
) {
  const clock = new FakeClock();
  let idCounter = 0;
  let replyFactory: ConversationDependencies["replyStream"] = () =>
    reply("default reply", { streamedAudio: true });
  const replyRequests: Parameters<
    ConversationDependencies["replyStream"]
  >[0][] = [];
  const transcriptInputs: Array<{
    onEvent: (event: TranscriptInputEvent) => void;
    onAudioEnergy: (energy: number) => void;
  }> = [];
  let speechResult = {
    fullText: "",
    durationMs: 600,
    audioUri: "file:///captured.m4a",
  };
  let speechCancelled = 0;
  let recordedText = "injected turn";
  const recordedRequests: Array<{
    uri: string;
    filename?: string;
    mimeType?: string;
  }> = [];
  let audioStopped = 0;
  let queueCreated = 0;
  let ended = 0;
  let closeoutPrepared = 0;
  const writes: Array<{ kind: "add" | "patch"; turnId: string }> = [];
  const telemetry: string[] = [];
  const savedAudio: Array<{ cacheKey: string; format: string }> = [];
  const synthesizedTexts: string[] = [];
  const playedAudioUris: string[] = [];
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
        transcriptInputs.push({ onEvent, onAudioEnergy });
        return {
          stop: async () => speechResult,
          cancel: async () => {
            speechCancelled += 1;
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
      replyRequests.push(request);
      return replyFactory(request);
    },
    audio: {
      createQueue: (queueOptions) => {
        queueCreated += 1;
        return {
          enqueue: async () => undefined,
          finish: async () => {
            queueOptions.onStarted();
            queueOptions.onCaptured(
              `file:///reply-${queueOptions.captureKey}.wav`,
            );
            queueOptions.onFinished();
          },
          stop: async () => undefined,
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
    transcriptInputs,
    recordedRequests,
    replyRequests,
    get speechCancelled() {
      return speechCancelled;
    },
    get audioStopped() {
      return audioStopped;
    },
    get queueCreated() {
      return queueCreated;
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
    setSpeechResult(next: typeof speechResult) {
      speechResult = next;
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
  await harness.engine.startListening();
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
