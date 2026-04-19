import * as FileSystem from 'expo-file-system/legacy';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { config, hasWorker } from '@/utils/config';
import { authHeaders, workerUrl } from '@/services/api';
import { sha256 } from '@/utils/hash';
import { log } from '@/utils/log';

export type TTSVoice = 'ja-female-1' | 'ja-female-2' | 'ja-male-1';

export type SynthesizeResult = {
  audioUri: string;
  durationMs: number;
  timestamps?: Array<{ word: string; startMs: number; endMs: number }>;
};

const CACHE_DIR = `${FileSystem.cacheDirectory}tts`;

async function ensureCacheDir() {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
}

let currentPlayer: AudioPlayer | null = null;

export async function synthesize(
  text: string,
  opts?: { voice?: TTSVoice; speed?: number; withTimestamps?: boolean },
): Promise<SynthesizeResult> {
  const voice = opts?.voice ?? 'ja-female-1';
  const speed = opts?.speed ?? 1.0;
  const key = await sha256(`${text}|${voice}|${speed}`);
  await ensureCacheDir();
  const file = `${CACHE_DIR}/${key}.mp3`;
  const meta = `${CACHE_DIR}/${key}.json`;

  const info = await FileSystem.getInfoAsync(file);
  if (info.exists) {
    const metaInfo = await FileSystem.getInfoAsync(meta);
    let durationMs = 0;
    let timestamps: SynthesizeResult['timestamps'];
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
    log.warn('TTS: worker URL unset — returning silent placeholder.');
    return { audioUri: file, durationMs: 0 };
  }

  try {
    const res = await fetch(workerUrl('/tts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text, voice, speed, withTimestamps: opts?.withTimestamps }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text().catch(() => '')}`);

    const durationHeader = Number(res.headers.get('X-Duration-Ms') ?? 0);
    const tsHeader = res.headers.get('X-Timestamps');
    let timestamps: SynthesizeResult['timestamps'];
    if (tsHeader) {
      try { timestamps = JSON.parse(tsHeader); } catch {}
    }

    const ab = await res.arrayBuffer();
    const bytes = new Uint8Array(ab);
    let bin = '';
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    const base64 = btoa(bin);
    await FileSystem.writeAsStringAsync(file, base64, { encoding: FileSystem.EncodingType.Base64 });
    await FileSystem.writeAsStringAsync(meta, JSON.stringify({ durationMs: durationHeader, timestamps }));
    return { audioUri: file, durationMs: durationHeader, timestamps };
  } catch (e) {
    log.error('TTS synth failed', e);
    throw e;
  }
}

declare function btoa(data: string): string;

export async function play(audioUri: string, opts?: { rate?: number }): Promise<void> {
  try {
    await stop();
    const player = createAudioPlayer({ uri: audioUri }, { updateInterval: 50 });
    if (opts?.rate) player.setPlaybackRate(opts.rate);
    currentPlayer = player;
    player.play();
  } catch (e) {
    log.error('TTS play failed', e);
  }
}

export async function stop(): Promise<void> {
  try {
    if (currentPlayer) {
      currentPlayer.pause();
      currentPlayer.remove();
      currentPlayer = null;
    }
  } catch (e) {
    log.warn('TTS stop noop', e);
  }
}

export function prefetch(text: string, voice: TTSVoice = 'ja-female-1'): void {
  synthesize(text, { voice }).catch(() => {});
}

export { config as _config };
