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

export function pcmBase64ChunksToWavBase64(
  chunks: string[],
  sampleRate: number,
  channels = 1,
): string {
  if (!chunks.length) return pcmBase64ToWavBase64("", sampleRate, channels);
  const pcmBinary = chunks.map((chunk) => atob(chunk)).join("");
  return pcmBase64ToWavBase64(btoa(pcmBinary), sampleRate, channels);
}
