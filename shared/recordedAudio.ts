export const RECORDED_AUDIO_MAX_BYTES = 20 * 1024 * 1024;
export const RECORDED_AUDIO_MAX_DURATION_MS = 5 * 60 * 1_000;
export const RECORDED_AUDIO_MIN_DURATION_MS = 80;

export type RecordedAudioFormat = "mp3" | "m4a" | "wav";

export type RecordedAudioMetadata = {
  filename: string;
  mimeType: string;
  format: RecordedAudioFormat;
  byteCount: number;
  sampleRate: number;
  channels: number;
  durationMs: number;
};

export type RecordedAudioFailureKind =
  | "empty-audio"
  | "audio-too-large"
  | "audio-too-long"
  | "unsupported-audio"
  | "invalid-audio"
  | "truncated-audio"
  | "audio-metadata-mismatch";

export class RecordedAudioContractError extends Error {
  constructor(
    public readonly kind: RecordedAudioFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "RecordedAudioContractError";
  }
}

const FORMAT_MIME_TYPES: Record<RecordedAudioFormat, readonly string[]> = {
  mp3: ["audio/mpeg", "audio/mp3"],
  m4a: ["audio/mp4", "audio/m4a", "audio/x-m4a"],
  wav: ["audio/wav", "audio/x-wav", "audio/wave"],
};

export const RECORDED_AUDIO_CANONICAL_MIME: Record<
  RecordedAudioFormat,
  string
> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
};

type ContainerObservation = {
  format: RecordedAudioFormat;
  sampleRate?: number;
  channels?: number;
  durationMs?: number;
};

export function formatForRecordedAudioFilename(
  filename: string,
): RecordedAudioFormat {
  const normalized = normalizeRecordedAudioFilename(filename);
  const extension = normalized.split(".").pop()?.toLowerCase();
  if (extension === "mp3" || extension === "m4a" || extension === "wav") {
    return extension;
  }
  throw new RecordedAudioContractError(
    "unsupported-audio",
    "Recorded audio must use an .mp3, .m4a, or .wav filename",
  );
}

export function formatForRecordedAudioMimeType(
  mimeType: string,
): RecordedAudioFormat {
  const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  for (const [format, supported] of Object.entries(FORMAT_MIME_TYPES) as Array<
    [RecordedAudioFormat, readonly string[]]
  >) {
    if (supported.includes(normalized)) return format;
  }
  throw new RecordedAudioContractError(
    "unsupported-audio",
    "Recorded audio MIME type must be MP3, M4A, or WAV",
  );
}

export function normalizeRecordedAudioFilename(filename: string): string {
  const decoded = filename.trim();
  if (
    !decoded ||
    decoded.length > 180 ||
    /[\u0000-\u001f\u007f/\\]/.test(decoded)
  ) {
    throw new RecordedAudioContractError(
      "invalid-audio",
      "Recorded audio filename is missing or invalid",
    );
  }
  return decoded;
}

export function validateRecordedAudioEnvelope(input: {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  byteCount?: number;
  sampleRate: number;
  channels: number;
  durationMs: number;
}): RecordedAudioMetadata {
  const filename = normalizeRecordedAudioFilename(input.filename);
  const filenameFormat = formatForRecordedAudioFilename(filename);
  const mimeType = input.mimeType.split(";", 1)[0]!.trim().toLowerCase();
  const mimeFormat = formatForRecordedAudioMimeType(mimeType);
  const byteCount = input.byteCount ?? input.bytes.byteLength;

  validateSize(byteCount);
  validateDecodedMetadata(input.sampleRate, input.channels, input.durationMs);

  if (filenameFormat !== mimeFormat) {
    throw new RecordedAudioContractError(
      "audio-metadata-mismatch",
      "Recorded audio filename and MIME type describe different formats",
    );
  }

  const observed = observeContainer(input.bytes, byteCount, filenameFormat);
  if (observed.format !== filenameFormat) {
    throw new RecordedAudioContractError(
      "audio-metadata-mismatch",
      "Recorded audio bytes do not match the filename and MIME type",
    );
  }

  if (
    observed.sampleRate !== undefined &&
    observed.sampleRate !== input.sampleRate
  ) {
    throw new RecordedAudioContractError(
      "audio-metadata-mismatch",
      "Recorded audio sample rate does not match the decoded file",
    );
  }
  if (observed.channels !== undefined && observed.channels !== input.channels) {
    throw new RecordedAudioContractError(
      "audio-metadata-mismatch",
      "Recorded audio channel count does not match the decoded file",
    );
  }
  if (
    observed.durationMs !== undefined &&
    Math.abs(observed.durationMs - input.durationMs) >
      Math.max(25, observed.durationMs * 0.02)
  ) {
    throw new RecordedAudioContractError(
      "audio-metadata-mismatch",
      "Recorded audio duration does not match the decoded file",
    );
  }

  return {
    filename,
    mimeType,
    format: filenameFormat,
    byteCount,
    sampleRate: input.sampleRate,
    channels: input.channels,
    durationMs: input.durationMs,
  };
}

function validateSize(byteCount: number): void {
  if (!Number.isSafeInteger(byteCount) || byteCount < 0) {
    throw new RecordedAudioContractError(
      "invalid-audio",
      "Recorded audio size is invalid",
    );
  }
  if (byteCount === 0) {
    throw new RecordedAudioContractError(
      "empty-audio",
      "Recorded audio file is empty",
    );
  }
  if (byteCount > RECORDED_AUDIO_MAX_BYTES) {
    throw new RecordedAudioContractError(
      "audio-too-large",
      `Recorded audio exceeds the ${RECORDED_AUDIO_MAX_BYTES}-byte limit`,
    );
  }
}

function validateDecodedMetadata(
  sampleRate: number,
  channels: number,
  durationMs: number,
): void {
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 8_000 ||
    sampleRate > 384_000 ||
    !Number.isInteger(channels) ||
    channels < 1 ||
    channels > 32 ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    throw new RecordedAudioContractError(
      "invalid-audio",
      "Recorded audio has invalid decoded metadata",
    );
  }
  if (durationMs < RECORDED_AUDIO_MIN_DURATION_MS) {
    throw new RecordedAudioContractError(
      "empty-audio",
      "Recorded audio contains no usable utterance",
    );
  }
  if (durationMs > RECORDED_AUDIO_MAX_DURATION_MS) {
    throw new RecordedAudioContractError(
      "audio-too-long",
      "Recorded audio exceeds the five-minute duration limit",
    );
  }
}

function observeContainer(
  bytes: Uint8Array,
  byteCount: number,
  expectedFormat: RecordedAudioFormat,
): ContainerObservation {
  if (!bytes.byteLength) {
    throw new RecordedAudioContractError(
      "empty-audio",
      "Recorded audio file is empty",
    );
  }

  if (ascii(bytes, 0, 4) === "RIFF" || ascii(bytes, 8, 12) === "WAVE") {
    return observeWav(bytes, byteCount);
  }
  if (ascii(bytes, 4, 8) === "ftyp") return observeM4a(bytes);
  if (ascii(bytes, 0, 3) === "ID3" || findMp3Frame(bytes) !== undefined) {
    return observeMp3(bytes);
  }

  if (
    (expectedFormat === "wav" && ascii(bytes, 0, 2) === "RI") ||
    (expectedFormat === "m4a" && bytes.byteLength < 12) ||
    (expectedFormat === "mp3" &&
      (ascii(bytes, 0, 3) === "ID3" || bytes[0] === 0xff))
  ) {
    throw new RecordedAudioContractError(
      "truncated-audio",
      "Recorded audio container is truncated",
    );
  }
  throw new RecordedAudioContractError(
    "invalid-audio",
    "Recorded audio bytes are not a valid MP3, M4A, or WAV container",
  );
}

function observeWav(
  bytes: Uint8Array,
  byteCount: number,
): ContainerObservation {
  if (
    bytes.byteLength < 12 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 12) !== "WAVE"
  ) {
    throw new RecordedAudioContractError(
      "truncated-audio",
      "WAV header is truncated",
    );
  }
  const riffBytes = readUint32LE(bytes, 4) + 8;
  if (riffBytes > byteCount) {
    throw new RecordedAudioContractError(
      "truncated-audio",
      "WAV payload is shorter than its declared size",
    );
  }

  let offset = 12;
  let sampleRate: number | undefined;
  let channels: number | undefined;
  let byteRate: number | undefined;
  let dataBytes: number | undefined;
  while (offset + 8 <= bytes.byteLength) {
    const chunk = ascii(bytes, offset, offset + 4);
    const chunkSize = readUint32LE(bytes, offset + 4);
    const payloadOffset = offset + 8;
    if (payloadOffset + chunkSize > byteCount) {
      throw new RecordedAudioContractError(
        "truncated-audio",
        "WAV chunk is shorter than its declared size",
      );
    }
    if (chunk === "fmt " && chunkSize >= 16) {
      if (payloadOffset + 16 > bytes.byteLength) break;
      const encoding = readUint16LE(bytes, payloadOffset);
      if (encoding !== 1 && encoding !== 3 && encoding !== 0xfffe) {
        throw new RecordedAudioContractError(
          "unsupported-audio",
          "WAV encoding is not PCM or IEEE float",
        );
      }
      channels = readUint16LE(bytes, payloadOffset + 2);
      sampleRate = readUint32LE(bytes, payloadOffset + 4);
      byteRate = readUint32LE(bytes, payloadOffset + 8);
    } else if (chunk === "data") {
      dataBytes = chunkSize;
      break;
    }
    offset = payloadOffset + chunkSize + (chunkSize % 2);
  }

  if (!sampleRate || !channels || !byteRate || dataBytes === undefined) {
    throw new RecordedAudioContractError(
      bytes.byteLength < byteCount ? "truncated-audio" : "invalid-audio",
      "WAV is missing a complete format or data chunk",
    );
  }
  if (!dataBytes) {
    throw new RecordedAudioContractError(
      "empty-audio",
      "WAV data chunk is empty",
    );
  }
  return {
    format: "wav",
    sampleRate,
    channels,
    durationMs: (dataBytes / byteRate) * 1_000,
  };
}

function observeM4a(bytes: Uint8Array): ContainerObservation {
  if (bytes.byteLength < 16 || ascii(bytes, 4, 8) !== "ftyp") {
    throw new RecordedAudioContractError(
      "truncated-audio",
      "M4A file-type box is truncated",
    );
  }
  const boxSize = readUint32BE(bytes, 0);
  if (boxSize < 16 || boxSize > bytes.byteLength) {
    throw new RecordedAudioContractError(
      "truncated-audio",
      "M4A file-type box is shorter than its declared size",
    );
  }
  const brands = ascii(bytes, 8, boxSize);
  if (!/(M4A |M4B |mp4[12]|isom|iso[2456]|qt  )/.test(brands)) {
    throw new RecordedAudioContractError(
      "unsupported-audio",
      "ISO media container is not an M4A audio file",
    );
  }
  if (
    !containsAscii(bytes, boxSize, "moov") &&
    !containsAscii(bytes, boxSize, "mdat")
  ) {
    throw new RecordedAudioContractError(
      "truncated-audio",
      "M4A media payload is missing or truncated",
    );
  }
  return { format: "m4a" };
}

function observeMp3(bytes: Uint8Array): ContainerObservation {
  if (ascii(bytes, 0, 3) === "ID3") {
    if (bytes.byteLength < 10) {
      throw new RecordedAudioContractError(
        "truncated-audio",
        "MP3 ID3 header is truncated",
      );
    }
    const tagSize =
      ((bytes[6]! & 0x7f) << 21) |
      ((bytes[7]! & 0x7f) << 14) |
      ((bytes[8]! & 0x7f) << 7) |
      (bytes[9]! & 0x7f);
    if (10 + tagSize >= bytes.byteLength) {
      throw new RecordedAudioContractError(
        "truncated-audio",
        "MP3 contains metadata but no complete audio frame",
      );
    }
  }
  const frame = findMp3Frame(bytes);
  if (!frame) {
    throw new RecordedAudioContractError(
      "truncated-audio",
      "MP3 contains no complete MPEG audio frame",
    );
  }
  return {
    format: "mp3",
    sampleRate: frame.sampleRate,
    channels: frame.channels,
  };
}

function findMp3Frame(
  bytes: Uint8Array,
): { sampleRate: number; channels: number } | undefined {
  for (let offset = 0; offset + 4 <= bytes.byteLength; offset += 1) {
    const first = bytes[offset]!;
    const second = bytes[offset + 1]!;
    if (first !== 0xff || (second & 0xe0) !== 0xe0) continue;
    const versionBits = (second >> 3) & 0x03;
    const layerBits = (second >> 1) & 0x03;
    if (versionBits === 1 || layerBits === 0) continue;
    const third = bytes[offset + 2]!;
    const bitrateIndex = (third >> 4) & 0x0f;
    const sampleRateIndex = (third >> 2) & 0x03;
    if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3)
      continue;

    const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
    const layer = layerBits === 3 ? 1 : layerBits === 2 ? 2 : 3;
    const baseSampleRates = [44_100, 48_000, 32_000];
    const sampleRate =
      baseSampleRates[sampleRateIndex]! /
      (version === 1 ? 1 : version === 2 ? 2 : 4);
    const bitrate = mp3BitrateKbps(version, layer, bitrateIndex);
    if (!bitrate) continue;
    const padding = (third >> 1) & 0x01;
    const frameLength =
      layer === 1
        ? Math.floor((12 * bitrate * 1_000) / sampleRate + padding) * 4
        : Math.floor(
            ((layer === 3 && version !== 1 ? 72 : 144) * bitrate * 1_000) /
              sampleRate +
              padding,
          );
    if (offset + frameLength > bytes.byteLength) continue;
    return {
      sampleRate,
      channels: bytes[offset + 3]! >> 6 === 3 ? 1 : 2,
    };
  }
  return undefined;
}

function mp3BitrateKbps(
  version: 1 | 2 | 2.5,
  layer: 1 | 2 | 3,
  index: number,
): number {
  const mpeg1 = {
    1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  } as const;
  const mpeg2 = {
    1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  } as const;
  return (version === 1 ? mpeg1 : mpeg2)[layer][index] ?? 0;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let value = "";
  for (let index = start; index < end && index < bytes.byteLength; index += 1) {
    value += String.fromCharCode(bytes[index]!);
  }
  return value;
}

function containsAscii(
  bytes: Uint8Array,
  start: number,
  value: string,
): boolean {
  for (
    let offset = start;
    offset + value.length <= bytes.byteLength;
    offset += 1
  ) {
    let matches = true;
    for (let index = 0; index < value.length; index += 1) {
      if (bytes[offset + index] !== value.charCodeAt(index)) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}
