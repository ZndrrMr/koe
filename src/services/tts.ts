import * as FileSystem from "expo-file-system/legacy";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { config, hasWorker } from "@/utils/config";
import { authHeaders, workerUrl } from "@/services/api";
import { sha256 } from "@/utils/hash";
import { log } from "@/utils/log";
import { pcmBase64ToWavBase64 } from "@/services/pcm";

export type TTSVoice = "ja-female-1" | "ja-female-2" | "ja-male-1";

export type SynthesizeResult = {
  audioUri: string;
  durationMs: number;
  timestamps?: Array<{ word: string; startMs: number; endMs: number }>;
};

const CACHE_DIR = `${FileSystem.cacheDirectory}tts`;

async function ensureCacheDir() {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists)
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
}

let currentPlayer: AudioPlayer | null = null;
let currentStream: PCMPlaybackQueue | null = null;

export async function synthesize(
  text: string,
  opts?: { voice?: TTSVoice; speed?: number; withTimestamps?: boolean },
): Promise<SynthesizeResult> {
  if (!text || !text.trim()) {
    return { audioUri: "", durationMs: 0 };
  }
  const voice = opts?.voice ?? "ja-female-1";
  const speed = opts?.speed ?? 1.0;
  const key = await sha256(`${text}|${voice}|${speed}`);
  await ensureCacheDir();
  const file = `${CACHE_DIR}/${key}.mp3`;
  const meta = `${CACHE_DIR}/${key}.json`;

  const info = await FileSystem.getInfoAsync(file);
  if (info.exists) {
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
    log.warn("TTS: worker URL unset — returning silent placeholder.");
    return { audioUri: file, durationMs: 0 };
  }

  try {
    const res = await fetch(workerUrl("/tts"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        text,
        voice,
        speed,
        withTimestamps: opts?.withTimestamps,
      }),
    });
    if (!res.ok)
      throw new Error(`TTS ${res.status}: ${await res.text().catch(() => "")}`);

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
    log.error("TTS synth failed", e);
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
  },
): Promise<void> {
  if (!audioUri) return;
  try {
    await stop();
    const player = createAudioPlayer({ uri: audioUri }, { updateInterval: 50 });
    if (opts?.rate) player.setPlaybackRate(opts.rate);
    currentPlayer = player;
    let started = false;
    let settled = false;
    const listener = player.addListener("playbackStatusUpdate", (status) => {
      if (status.playing && !started) {
        started = true;
        opts?.onStarted?.();
      }
      if (status.playbackState === "failed" && !settled) {
        settled = true;
        listener.remove();
        if (currentPlayer === player) currentPlayer = null;
        player.remove();
        opts?.onError?.(new Error("Audio playback failed"));
      } else if (status.didJustFinish && !settled) {
        settled = true;
        listener.remove();
        if (currentPlayer === player) currentPlayer = null;
        player.remove();
        opts?.onFinished?.();
      }
    });
    player.play();
  } catch (e) {
    log.error("TTS play failed", e);
    opts?.onError?.(
      e instanceof Error ? e : new Error("Audio playback could not start"),
    );
  }
}

export async function stop(): Promise<void> {
  if (currentStream) {
    const stream = currentStream;
    currentStream = null;
    await stream.stop();
  }
  try {
    if (currentPlayer) {
      currentPlayer.pause();
      currentPlayer.remove();
      currentPlayer = null;
    }
  } catch (e) {
    log.warn("TTS stop noop", e);
  }
}

type PCMPlaybackQueueOptions = {
  onStarted?: () => void;
  onFinished?: () => void;
  onError?: (error: Error) => void;
};

export class PCMPlaybackQueue {
  private queuedUris: string[] = [];
  private player: AudioPlayer | null = null;
  private stopped = false;
  private inputFinished = false;
  private started = false;
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
    this.writeChain = this.writeChain.then(async () => {
      if (this.stopped) return;
      await ensureCacheDir();
      const uri = `${CACHE_DIR}/stream-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`;
      const wav = pcmBase64ToWavBase64(audioBase64, sampleRate, channels);
      await FileSystem.writeAsStringAsync(uri, wav, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (this.stopped) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
        return;
      }
      this.queuedUris.push(uri);
      this.drain();
    });
    return this.writeChain;
  }

  async finish(): Promise<void> {
    await this.writeChain;
    this.inputFinished = true;
    this.maybeFinish();
    return this.done;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const player = this.player;
    this.player = null;
    if (player) {
      try {
        player.pause();
        player.remove();
      } catch {}
    }
    const pending = this.queuedUris.splice(0);
    await Promise.all(
      pending.map((uri) =>
        FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}),
      ),
    );
    if (currentStream === this) currentStream = null;
    this.resolveDone();
  }

  private drain(): void {
    if (this.stopped || this.player || !this.queuedUris.length) {
      this.maybeFinish();
      return;
    }
    const uri = this.queuedUris.shift()!;
    const player = createAudioPlayer(
      { uri },
      { updateInterval: 25, keepAudioSessionActive: true },
    );
    this.player = player;
    const listener = player.addListener("playbackStatusUpdate", (status) => {
      if (status.playing && !this.started) {
        this.started = true;
        this.options.onStarted?.();
      }
      if (status.playbackState === "failed") {
        listener.remove();
        void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        void this.stop().then(() => {
          this.options.onError?.(new Error("Streamed audio playback failed"));
        });
        return;
      }
      if (!status.didJustFinish) return;
      listener.remove();
      if (this.player === player) this.player = null;
      player.remove();
      void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      this.drain();
    });
    player.play();
  }

  private maybeFinish(): void {
    if (
      !this.inputFinished ||
      this.player ||
      this.queuedUris.length ||
      this.stopped
    )
      return;
    if (currentStream === this) currentStream = null;
    this.options.onFinished?.();
    this.resolveDone();
  }
}

export function prefetch(text: string, voice: TTSVoice = "ja-female-1"): void {
  synthesize(text, { voice }).catch(() => {});
}

export { config as _config };
