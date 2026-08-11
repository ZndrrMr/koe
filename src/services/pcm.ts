function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1)
    target[offset + index] = value.charCodeAt(index);
}

function writeUint16LE(
  target: Uint8Array,
  offset: number,
  value: number,
): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32LE(
  target: Uint8Array,
  offset: number,
  value: number,
): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

/**
 * Returns a perceptual 0...1 energy value for signed 16-bit little-endian PCM.
 * The square-root curve keeps quiet speech visible without letting peaks pin the
 * acoustic form at its maximum width.
 */
export function pcm16EnergyFromBase64(pcmBase64: string): number {
  if (!pcmBase64) return 0;
  const pcm = atob(pcmBase64);
  const sampleCount = Math.floor(pcm.length / 2);
  if (!sampleCount) return 0;

  // Sample at most ~2k values per streamed chunk. This is visual metering, not
  // signal analysis, and should never delay audio queueing.
  const stride = Math.max(1, Math.floor(sampleCount / 2_048));
  let sumSquares = 0;
  let measured = 0;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += stride) {
    const byteIndex = sampleIndex * 2;
    const unsigned =
      pcm.charCodeAt(byteIndex) | (pcm.charCodeAt(byteIndex + 1) << 8);
    const signed = unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
    const normalized = signed / 0x8000;
    sumSquares += normalized * normalized;
    measured += 1;
  }

  const rms = Math.sqrt(sumSquares / measured);
  return Math.min(1, Math.sqrt(rms * 3.2));
}

export function pcmBase64ToWavBase64(
  pcmBase64: string,
  sampleRate: number,
  channels = 1,
  bitsPerSample = 16,
): string {
  const pcmBinary = atob(pcmBase64);
  const wav = new Uint8Array(44 + pcmBinary.length);
  writeAscii(wav, 0, "RIFF");
  writeUint32LE(wav, 4, 36 + pcmBinary.length);
  writeAscii(wav, 8, "WAVE");
  writeAscii(wav, 12, "fmt ");
  writeUint32LE(wav, 16, 16);
  writeUint16LE(wav, 20, 1);
  writeUint16LE(wav, 22, channels);
  writeUint32LE(wav, 24, sampleRate);
  writeUint32LE(wav, 28, sampleRate * channels * (bitsPerSample / 8));
  writeUint16LE(wav, 32, channels * (bitsPerSample / 8));
  writeUint16LE(wav, 34, bitsPerSample);
  writeAscii(wav, 36, "data");
  writeUint32LE(wav, 40, pcmBinary.length);
  for (let index = 0; index < pcmBinary.length; index += 1)
    wav[44 + index] = pcmBinary.charCodeAt(index);

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < wav.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...wav.subarray(offset, Math.min(offset + chunkSize, wav.length)),
    );
  }
  return btoa(binary);
}
