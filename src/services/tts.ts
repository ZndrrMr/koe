import * as FileSystem from "expo-file-system/legacy";
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from "expo-audio";
import {
  AudioContext,
  AudioManager,
  type AudioBufferQueueSourceNode,
} from "react-native-audio-api";
import { config, hasWorker } from "@/utils/config";
import { authHeaders, workerUrl } from "@/services/api";
import { sha256 } from "@/utils/hash";
import { log } from "@/utils/log";
import {
  AudioContractError,
  decodeBase64Audio,
  validateInworldStandaloneMP3,
} from "@/services/audioContract";
import {
  errorName,
  voiceEvent,
  type VoiceTraceContext,
} from "@/utils/telemetry";
import {
  INWORLD_STANDALONE_AUDIO_CONTRACT,
  KOE_V1_VOICE_ID,
} from "../../shared/inworld";
import {
  pcm16EnergyFromBase64,
  pcmBase64ChunksToWavBase64,
} from "@/services/pcm";

export type SynthesizeResult = {
  audioUri: string;
  durationMs: number;
  timestamps?: Array<{ word: string; startMs: number; endMs: number }>;
};

export class AudioPlaybackError extends Error {
  constructor(
    public readonly kind:
      | "audio-session"
      | "interrupted"
      | "player-status"
      | "capture",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AudioPlaybackError";
  }
}

const CACHE_DIR = `${FileSystem.cacheDirectory}tts`;

async function ensureCacheDir() {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists)
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
}

let currentPlayer: AudioPlayer | null = null;
let currentStream: PCMPlaybackQueue | null = null;
let settleCurrentPlayer: (() => void) | null = null;
const STANDALONE_PLAYBACK_WATCHDOG_MS = 180_000;

async function configurePlaybackAudioSession(): Promise<void> {
  await setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: "doNotMix",
    allowsRecording: false,
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  });
  AudioManager.setAudioSessionOptions({
    iosCategory: "playback",
    iosMode: "spokenAudio",
    iosOptions: [],
    iosNotifyOthersOnDeactivation: true,
  });
}

export async function synthesize(
  text: string,
  opts?: {
    speed?: number;
    withTimestamps?: boolean;
    trace?: VoiceTraceContext;
  },
): Promise<SynthesizeResult> {
  if (!text || !text.trim()) {
    return { audioUri: "", durationMs: 0 };
  }
  const speed = opts?.speed ?? 1.0;
  // Version the cache around the one V1 voice so audio created by a removed
  // voice preference can never leak into a current conversation.
  const key = await sha256(`v1-asuka|${text}|${speed}`);
  await ensureCacheDir();
  const file = `${CACHE_DIR}/${key}.mp3`;
  const meta = `${CACHE_DIR}/${key}.json`;

  const info = await FileSystem.getInfoAsync(file);
  if (info.exists) {
    voiceEvent("standalone_tts_cache_hit", opts?.trace, {
      path: "cache",
    });
    const metaInfo = await FileSystem.getInfoAsync(meta);
    let durationMs = 0;
    let timestamps: SynthesizeResult["timestamps"];
    if (metaInfo.exists) {
      try {
        const parsed = JSON.parse(await FileSystem.readAsStringAsync(meta));
        durationMs = parsed.durationMs ?? 0;
        timestamps = parsed.timestamps;
      } catch {}
    }
    return { audioUri: file, durationMs, timestamps };
  }

  if (!hasWorker()) {
    log.warn("TTS: worker URL unset — no playable fallback is available.");
    voiceEvent(
      "standalone_tts_unavailable",
      opts?.trace,
      {
        failureKind: "worker-unset",
      },
      "warn",
    );
    throw new AudioContractError(
      "empty-audio",
      "No standalone speech provider is configured",
    );
  }

  try {
    voiceEvent("standalone_tts_started", opts?.trace, {
      voiceId: KOE_V1_VOICE_ID,
      declaredEncoding: INWORLD_STANDALONE_AUDIO_CONTRACT.encoding,
      sampleRate: INWORLD_STANDALONE_AUDIO_CONTRACT.sampleRate,
      channels: INWORLD_STANDALONE_AUDIO_CONTRACT.channels,
    });
    const res = await fetch(workerUrl("/tts"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders({
          "X-Koe-Session-Id": opts?.trace?.sessionId ?? "",
          "X-Koe-Turn-Id": opts?.trace?.turnId ?? "",
          "X-Koe-Response-Run-Id": opts?.trace?.responseRunId ?? "",
        }),
      },
      body: JSON.stringify({
        text,
        speed,
        withTimestamps: opts?.withTimestamps,
      }),
    });
    if (!res.ok)
      throw new Error(`TTS request failed with status ${res.status}`);

    const durationHeader = Number(res.headers.get("X-Duration-Ms") ?? 0);
    const tsHeader = res.headers.get("X-Timestamps");
    let timestamps: SynthesizeResult["timestamps"];
    if (tsHeader) {
      try {
        timestamps = JSON.parse(tsHeader);
      } catch {}
    }

    const ab = await res.arrayBuffer();
    const bytes = new Uint8Array(ab);
    const declaredEncoding = res.headers.get("X-Koe-Audio-Encoding");
    const declaredSampleRate = res.headers.get("X-Koe-Audio-Sample-Rate");
    const declaredChannels = res.headers.get("X-Koe-Audio-Channels");
    const hasDeclaredContract =
      declaredEncoding !== null &&
      declaredSampleRate !== null &&
      declaredChannels !== null;
    const hasAnyDeclaredContract =
      declaredEncoding !== null ||
      declaredSampleRate !== null ||
      declaredChannels !== null;
    // Older deployed Workers return the canonical MP3 body and content type
    // without the newer X-Koe contract headers. In that case inspect the
    // bytes themselves; if any declaration is present, require the complete
    // canonical contract rather than silently accepting partial metadata.
    if (hasAnyDeclaredContract && !hasDeclaredContract) {
      throw new AudioContractError(
        "encoding-mismatch",
        "Standalone audio response contained an incomplete declared contract",
      );
    }
    const observation = validateInworldStandaloneMP3(
      bytes,
      res.headers.get("Content-Type"),
      hasDeclaredContract
        ? {
            encoding: declaredEncoding,
            sampleRate: Number(declaredSampleRate),
            channels: Number(declaredChannels),
          }
        : undefined,
    );
    voiceEvent("standalone_tts_decoded", opts?.trace, {
      path: hasDeclaredContract ? "worker-contract" : "worker-compat",
      status: res.status,
      providerRequestId:
        res.headers.get("X-Koe-Provider-Request-Id") ?? undefined,
      contentType: res.headers.get("Content-Type") ?? "none",
      declaredEncoding: observation.declaredEncoding,
      observedEncoding: observation.observedEncoding,
      sampleRate: observation.sampleRate,
      channels: observation.channels,
      byteCount: observation.byteCount,
    });
    let bin = "";
    for (let i = 0; i < bytes.byteLength; i++)
      bin += String.fromCharCode(bytes[i]);
    const base64 = btoa(bin);
    await FileSystem.writeAsStringAsync(file, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.writeAsStringAsync(
      meta,
      JSON.stringify({ durationMs: durationHeader, timestamps }),
    );
    return { audioUri: file, durationMs: durationHeader, timestamps };
  } catch (e) {
    voiceEvent(
      "standalone_tts_failed",
      opts?.trace,
      {
        failureKind: e instanceof AudioContractError ? e.kind : "provider",
        errorName: errorName(e),
      },
      "error",
    );
    throw e;
  }
}

declare function btoa(data: string): string;

export async function saveAudioFromBase64(
  base64: string,
  cacheKey: string,
  format: string = "wav",
): Promise<string> {
  await ensureCacheDir();
  const ext = ["flac", "mp3", "wav", "ogg", "aac", "m4a"].includes(format)
    ? format
    : "wav";
  const file = `${CACHE_DIR}/${cacheKey}.${ext}`;
  await FileSystem.writeAsStringAsync(file, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return file;
}

export async function play(
  audioUri: string,
  opts?: {
    rate?: number;
    onStarted?: () => void;
    onFinished?: () => void;
    onError?: (error: Error) => void;
    trace?: VoiceTraceContext;
  },
): Promise<void> {
  if (!audioUri) return;
  try {
    await stop();
    await configurePlaybackAudioSession();
    const player = createAudioPlayer({ uri: audioUri }, { updateInterval: 50 });
    voiceEvent("audio_session_ready", opts?.trace, {
      path: "standalone",
      category: "playback",
      mode: "spokenAudio",
      options: "none",
      route: "system-selected",
    });
    if (opts?.rate) player.setPlaybackRate(opts.rate);
    currentPlayer = player;
    let started = false;
    let settled = false;
    let listener: { remove: () => void } | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    await new Promise<void>((resolve) => {
      const settle = () => {
        if (settled) return;
        settled = true;
        if (watchdog) clearTimeout(watchdog);
        listener?.remove();
        if (currentPlayer === player) currentPlayer = null;
        if (settleCurrentPlayer === settle) settleCurrentPlayer = null;
        try {
          player.remove();
        } catch (error) {
          log.warn("TTS player removal noop", error);
        }
        resolve();
      };
      const failPlayback = (error: AudioPlaybackError) => {
        if (settled) return;
        voiceEvent(
          "playback_failed",
          opts?.trace,
          {
            path: "standalone",
            failureKind: error.kind,
          },
          "error",
        );
        settle();
        opts?.onError?.(error);
      };
      settleCurrentPlayer = settle;
      try {
        listener = player.addListener("playbackStatusUpdate", (status) => {
          if (status.playing && !started) {
            started = true;
            voiceEvent("playback_started", opts?.trace, {
              path: "standalone",
            });
            opts?.onStarted?.();
          }
          if (status.playbackState === "failed") {
            failPlayback(
              new AudioPlaybackError("player-status", "Audio playback failed"),
            );
          } else if (status.didJustFinish && !settled) {
            voiceEvent("playback_ended", opts?.trace, { path: "standalone" });
            settle();
            opts?.onFinished?.();
          }
        });
        watchdog = setTimeout(() => {
          failPlayback(
            new AudioPlaybackError(
              "player-status",
              "Audio playback did not finish before its watchdog",
            ),
          );
        }, STANDALONE_PLAYBACK_WATCHDOG_MS);
        player.play();
      } catch (error) {
        failPlayback(
          new AudioPlaybackError(
            "audio-session",
            "Audio playback could not start",
            { cause: error },
          ),
        );
      }
    });
  } catch (e) {
    voiceEvent(
      "audio_session_failed",
      opts?.trace,
      {
        path: "standalone",
        errorName: errorName(e),
      },
      "error",
    );
    opts?.onError?.(
      e instanceof AudioPlaybackError
        ? e
        : new AudioPlaybackError(
            "audio-session",
            "Audio playback could not start",
            { cause: e },
          ),
    );
  }
}

export async function stop(): Promise<void> {
  if (currentStream) {
    const stream = currentStream;
    currentStream = null;
    await stream.stop();
  }
  const player = currentPlayer;
  if (!player) return;
  try {
    player.pause();
  } catch (error) {
    log.warn("TTS player pause noop", error);
  }
  if (settleCurrentPlayer) {
    settleCurrentPlayer();
    return;
  }
  currentPlayer = null;
  try {
    player.remove();
  } catch (error) {
    log.warn("TTS player removal noop", error);
  }
}

type PCMPlaybackQueueOptions = {
  onStarted?: () => void;
  onFinished?: () => void;
  onError?: (error: Error) => void;
  onEnergy?: (energy: number) => void;
  captureKey?: string;
  onCaptured?: (audioUri: string) => void;
  trace?: VoiceTraceContext;
};

export class PCMPlaybackQueue {
  private context: AudioContext | null = null;
  private source: AudioBufferQueueSourceNode | null = null;
  private interruptionSubscription?: { remove: () => void };
  private readonly pendingBufferIds = new Set<string>();
  private stopped = false;
  private inputFinished = false;
  private started = false;
  private settled = false;
  private captured = false;
  private captureChunks: string[] = [];
  private captureSampleRate?: number;
  private captureChannels?: number;
  private writeChain: Promise<void> = Promise.resolve();
  private resolveDone!: () => void;
  private readonly done = new Promise<void>((resolve) => {
    this.resolveDone = resolve;
  });

  constructor(private readonly options: PCMPlaybackQueueOptions = {}) {
    currentStream = this;
  }

  enqueue(
    audioBase64: string,
    sampleRate = 48_000,
    channels = 1,
  ): Promise<void> {
    if (!audioBase64 || this.stopped) return Promise.resolve();
    const byteCount = decodeBase64Audio(audioBase64).byteLength;
    if (
      (this.captureSampleRate !== undefined &&
        this.captureSampleRate !== sampleRate) ||
      (this.captureChannels !== undefined && this.captureChannels !== channels)
    ) {
      return Promise.reject(
        new AudioPlaybackError(
          "audio-session",
          "Streamed audio format changed within one response",
        ),
      );
    }
    this.captureChunks.push(audioBase64);
    this.captureSampleRate = sampleRate;
    this.captureChannels = channels;
    this.options.onEnergy?.(pcm16EnergyFromBase64(audioBase64));
    voiceEvent("playback_chunk_queued", this.options.trace, {
      path: "stream",
      byteCount,
      queueDepth: this.pendingBufferIds.size + 1,
      declaredEncoding: "pcm_s16le",
      observedEncoding: "pcm_s16le",
      sampleRate,
      channels,
    });
    this.writeChain = this.writeChain.then(async () => {
      if (this.stopped) return;
      try {
        await this.ensureAudioGraph(sampleRate);
        if (this.stopped || !this.context || !this.source) return;
        const bytes = decodeBase64Audio(audioBase64);
        const frameCount = bytes.byteLength / (channels * 2);
        const buffer = this.context.createBuffer(
          channels,
          frameCount,
          sampleRate,
        );
        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        );
        for (let channel = 0; channel < channels; channel += 1) {
          const samples = new Float32Array(frameCount);
          for (let frame = 0; frame < frameCount; frame += 1) {
            const offset = (frame * channels + channel) * 2;
            samples[frame] = view.getInt16(offset, true) / 32_768;
          }
          buffer.copyToChannel(samples, channel);
        }
        const bufferId = this.source.enqueueBuffer(buffer);
        this.pendingBufferIds.add(bufferId);
        if (!this.started) {
          this.started = true;
          // RNAudioAPI's queue source currently defaults an omitted offset to
          // -1 and rejects it before reaching native code. Pass the canonical
          // zero offset explicitly so the first queued buffer can start.
          this.source.start(0, 0);
          voiceEvent("playback_started", this.options.trace, {
            path: "stream",
            queueDepth: this.pendingBufferIds.size,
          });
          this.options.onStarted?.();
        }
      } catch (error) {
        voiceEvent(
          "audio_session_failed",
          this.options.trace,
          {
            path: "stream",
            errorName: errorName(error),
          },
          "error",
        );
        throw error instanceof AudioPlaybackError
          ? error
          : new AudioPlaybackError(
              "audio-session",
              "Streamed audio session failed",
              { cause: error },
            );
      }
    });
    return this.writeChain;
  }

  async finish(): Promise<void> {
    await this.writeChain;
    if (this.stopped) return this.done;
    if (!this.captureChunks.length) {
      throw new AudioPlaybackError(
        "capture",
        "Streamed playback finished without audio",
      );
    }
    await this.persistCapture();
    this.inputFinished = true;
    voiceEvent("playback_input_finished", this.options.trace, {
      path: "stream",
      queueDepth: this.pendingBufferIds.size,
    });
    this.maybeFinish();
    return this.done;
  }

  async stop(): Promise<void> {
    if (this.stopped) return this.done;
    this.stopped = true;
    await this.writeChain.catch(() => {});
    this.captureChunks = [];
    this.pendingBufferIds.clear();
    voiceEvent(
      "playback_cancelled",
      this.options.trace,
      {
        path: "stream",
        queueDepth: 0,
      },
      "warn",
    );
    await this.releaseAudioGraph();
    if (currentStream === this) currentStream = null;
    this.options.onEnergy?.(0);
    this.settleDone();
    return this.done;
  }

  private async ensureAudioGraph(sampleRate: number): Promise<void> {
    if (this.context && this.source) return;
    await configurePlaybackAudioSession();
    AudioManager.observeAudioInterruptions(true);
    this.interruptionSubscription = AudioManager.addSystemEventListener(
      "interruption",
      (event) => {
        if (event.type !== "began") return;
        voiceEvent(
          "playback_failed",
          this.options.trace,
          {
            path: "stream",
            failureKind: "interrupted",
            queueDepth: this.pendingBufferIds.size,
          },
          "error",
        );
        void this.fail(
          new AudioPlaybackError(
            "interrupted",
            "The streamed audio session was interrupted",
          ),
        );
      },
    );
    AudioManager.setAudioSessionOptions({
      iosCategory: "playback",
      iosMode: "spokenAudio",
      iosOptions: [],
      iosNotifyOthersOnDeactivation: true,
    });
    await AudioManager.setAudioSessionActivity(true);
    const context = new AudioContext({ sampleRate });
    const source = context.createBufferQueueSource({ pitchCorrection: false });
    source.connect(context.destination);
    source.onBufferEnded = (event) => {
      this.pendingBufferIds.delete(event.bufferId);
      voiceEvent("playback_chunk_ended", this.options.trace, {
        path: "stream",
        queueDepth: this.pendingBufferIds.size,
      });
      this.maybeFinish();
    };
    this.context = context;
    this.source = source;
    await context.resume();
    voiceEvent("audio_session_ready", this.options.trace, {
      path: "stream",
      category: "playback",
      mode: "spokenAudio",
      options: "none",
      route: "system-selected",
      sampleRate,
      channels: this.captureChannels,
    });
  }

  private async persistCapture(): Promise<void> {
    if (
      this.captured ||
      !this.captureChunks.length ||
      !this.options.captureKey ||
      this.captureSampleRate === undefined ||
      this.captureChannels === undefined
    ) {
      return;
    }
    this.captured = true;
    try {
      const wav = pcmBase64ChunksToWavBase64(
        this.captureChunks,
        this.captureSampleRate,
        this.captureChannels,
      );
      const uri = await saveAudioFromBase64(
        wav,
        `stream-${this.options.captureKey}`,
        "wav",
      );
      this.options.onCaptured?.(uri);
    } catch (error) {
      throw new AudioPlaybackError(
        "capture",
        "Could not preserve streamed reply audio",
        { cause: error },
      );
    } finally {
      this.captureChunks = [];
    }
  }

  private maybeFinish(): void {
    if (
      !this.inputFinished ||
      this.pendingBufferIds.size ||
      this.stopped ||
      this.settled
    )
      return;
    this.settled = true;
    void this.releaseAudioGraph()
      .then(() => {
        if (currentStream === this) currentStream = null;
        this.options.onEnergy?.(0);
        voiceEvent("playback_ended", this.options.trace, {
          path: "stream",
          queueDepth: 0,
        });
        this.options.onFinished?.();
        this.resolveDone();
      })
      .catch((error) => {
        const playbackError =
          error instanceof AudioPlaybackError
            ? error
            : new AudioPlaybackError(
                "audio-session",
                "Could not close streamed playback cleanly",
                { cause: error },
              );
        this.options.onError?.(playbackError);
        this.resolveDone();
      });
  }

  private async fail(error: AudioPlaybackError): Promise<void> {
    if (this.stopped || (this.settled && !this.context)) return;
    this.stopped = true;
    this.captureChunks = [];
    this.pendingBufferIds.clear();
    await this.releaseAudioGraph().catch(() => {});
    if (currentStream === this) currentStream = null;
    this.options.onEnergy?.(0);
    this.options.onError?.(error);
    this.settleDone();
  }

  private async releaseAudioGraph(): Promise<void> {
    const source = this.source;
    const context = this.context;
    this.source = null;
    this.context = null;
    this.interruptionSubscription?.remove();
    this.interruptionSubscription = undefined;
    AudioManager.observeAudioInterruptions(false);
    if (source) {
      source.onBufferEnded = null;
      try {
        source.stop();
      } catch {}
      try {
        source.disconnect();
      } catch {}
    }
    if (context) await context.close();
    await AudioManager.setAudioSessionActivity(false).catch(() => {});
  }

  private settleDone(): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveDone();
  }
}

export function prefetch(text: string): void {
  synthesize(text).catch(() => {});
}

export { config as _config };
