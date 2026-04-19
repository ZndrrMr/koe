import * as FileSystem from 'expo-file-system/legacy';
import { PitchDetector } from 'pitchy';
import { log } from '@/utils/log';

type Contour = { f0: number[]; timestamps: number[] };
type ContourWithRatio = Contour & { voicedRatio: number };

const WINDOW_MS = 25;
const HOP_MS = 10;
const MIN_CLARITY = 0.75;

export async function extractContour(audioUri: string): Promise<ContourWithRatio> {
  try {
    const { samples, sampleRate } = await decodePcm(audioUri);
    if (!samples) return { f0: [], timestamps: [], voicedRatio: 0 };
    return extractFromPcm(samples, sampleRate);
  } catch (e) {
    log.warn('extractContour failed, returning empty.', e);
    return { f0: [], timestamps: [], voicedRatio: 0 };
  }
}

export function extractFromPcm(samples: Float32Array, sampleRate: number): ContourWithRatio {
  const windowSize = Math.max(1024, Math.floor((WINDOW_MS / 1000) * sampleRate));
  const hopSize = Math.max(256, Math.floor((HOP_MS / 1000) * sampleRate));
  const detector = PitchDetector.forFloat32Array(windowSize);
  detector.minVolumeDecibels = -40;

  const f0: number[] = [];
  const timestamps: number[] = [];
  let voiced = 0;

  for (let offset = 0; offset + windowSize <= samples.length; offset += hopSize) {
    const frame = samples.subarray(offset, offset + windowSize);
    const [pitch, clarity] = detector.findPitch(frame, sampleRate);
    const ts = (offset / sampleRate) * 1000;
    if (clarity >= MIN_CLARITY && pitch >= 50 && pitch <= 500) {
      f0.push(pitch);
      voiced++;
    } else {
      f0.push(-1);
    }
    timestamps.push(ts);
  }
  return { f0, timestamps, voicedRatio: timestamps.length ? voiced / timestamps.length : 0 };
}

/**
 * Decode an audio file to mono 16kHz Float32 PCM.
 * Implementation: reads the raw file bytes, pulls PCM from WAV directly,
 * and for AAC/MP3 returns null (would require a decoder we don't ship).
 * Returning null means callers fall back gracefully.
 */
async function decodePcm(
  audioUri: string,
): Promise<{ samples: Float32Array | null; sampleRate: number }> {
  const lowered = audioUri.toLowerCase();
  if (lowered.endsWith('.wav')) {
    const base64 = await FileSystem.readAsStringAsync(audioUri, { encoding: FileSystem.EncodingType.Base64 });
    return decodeWav(base64);
  }
  // m4a/mp3: on-device decode requires a native module we skip in v1.
  // Stub: return empty — the UI still renders, just without a contour.
  return { samples: null, sampleRate: 16000 };
}

function decodeWav(base64: string): { samples: Float32Array; sampleRate: number } {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dv = new DataView(bytes.buffer);
  // WAV header: 44 bytes for standard PCM
  const sampleRate = dv.getUint32(24, true);
  const bitsPerSample = dv.getUint16(34, true);
  const numChannels = dv.getUint16(22, true);
  const dataStart = findWavDataChunk(dv) ?? 44;
  const dataLen = dv.getUint32(dataStart - 4, true);
  const sampleCount = dataLen / (bitsPerSample / 8) / numChannels;
  const out = new Float32Array(sampleCount);
  if (bitsPerSample === 16) {
    for (let i = 0; i < sampleCount; i++) {
      let sum = 0;
      for (let c = 0; c < numChannels; c++) {
        sum += dv.getInt16(dataStart + i * numChannels * 2 + c * 2, true);
      }
      out[i] = sum / numChannels / 32768;
    }
  }
  return { samples: out, sampleRate };
}

function findWavDataChunk(dv: DataView): number | null {
  let offset = 12;
  while (offset < dv.byteLength - 8) {
    const id = String.fromCharCode(
      dv.getUint8(offset), dv.getUint8(offset + 1),
      dv.getUint8(offset + 2), dv.getUint8(offset + 3),
    );
    const size = dv.getUint32(offset + 4, true);
    if (id === 'data') return offset + 8;
    offset += 8 + size;
  }
  return null;
}

export function compareContours(
  native: Contour,
  user: Contour,
): { dtwDistance: number; normalizedScore: number; alignmentPath: Array<[number, number]> } {
  const n = toSemitonesCentered(native.f0);
  const u = toSemitonesCentered(user.f0);
  if (!n.length || !u.length) {
    return { dtwDistance: Infinity, normalizedScore: 0, alignmentPath: [] };
  }
  const { distance, path } = dtw(n, u);
  const normalized = distance / Math.max(1, path.length);
  // map 0..~12 semitones avg → 100..0
  const score = Math.max(0, Math.min(100, Math.round(100 - normalized * 10)));
  return { dtwDistance: distance, normalizedScore: score, alignmentPath: path };
}

function toSemitonesCentered(f0: number[]): number[] {
  const voiced = f0.filter((v) => v > 0);
  if (!voiced.length) return [];
  const mean = voiced.reduce((a, b) => a + b, 0) / voiced.length;
  return f0.map((v) => (v > 0 ? 12 * Math.log2(v / mean) : NaN)).filter((v) => Number.isFinite(v));
}

function dtw(a: number[], b: number[]): { distance: number; path: Array<[number, number]> } {
  const n = a.length;
  const m = b.length;
  const D = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    D[i] = new Float32Array(m + 1);
    for (let j = 0; j <= m; j++) D[i][j] = Infinity;
  }
  D[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = Math.abs(a[i - 1] - b[j - 1]);
      D[i][j] = cost + Math.min(D[i - 1][j], D[i][j - 1], D[i - 1][j - 1]);
    }
  }
  const path: Array<[number, number]> = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    const min = Math.min(D[i - 1][j - 1], D[i - 1][j], D[i][j - 1]);
    if (min === D[i - 1][j - 1]) { i--; j--; }
    else if (min === D[i - 1][j]) { i--; }
    else { j--; }
  }
  return { distance: D[n][m], path: path.reverse() };
}

// Shim for atob on React Native where it's globally defined at runtime but not typed.
declare function atob(data: string): string;
