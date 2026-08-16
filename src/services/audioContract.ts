import {
  INWORLD_ROUTER_AUDIO_CONTRACT,
  INWORLD_STANDALONE_AUDIO_CONTRACT,
  observeMP3Audio,
  type DeclaredAudioContract,
} from "../../shared/inworld";

export type AudioContractFailureKind =
  | "empty-audio"
  | "invalid-base64"
  | "invalid-frame-alignment"
  | "encoding-mismatch"
  | "sample-rate-mismatch"
  | "channel-mismatch"
  | "content-type-mismatch";

export class AudioContractError extends Error {
  constructor(
    public readonly kind: AudioContractFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "AudioContractError";
  }
}

export type AudioObservation = {
  declaredEncoding: string;
  observedEncoding: string;
  sampleRate: number;
  channels: number;
  byteCount: number;
  frameCount?: number;
};

function assertDeclaredContract(
  declared: DeclaredAudioContract,
  expected: DeclaredAudioContract,
): void {
  if (declared.encoding.toLowerCase() !== expected.encoding.toLowerCase()) {
    throw new AudioContractError(
      "encoding-mismatch",
      `Expected ${expected.encoding} audio, received ${declared.encoding}`,
    );
  }
  if (declared.sampleRate !== expected.sampleRate) {
    throw new AudioContractError(
      "sample-rate-mismatch",
      `Expected ${expected.sampleRate} Hz, received ${declared.sampleRate} Hz`,
    );
  }
  if (declared.channels !== expected.channels) {
    throw new AudioContractError(
      "channel-mismatch",
      `Expected ${expected.channels} channel(s), received ${declared.channels}`,
    );
  }
}

export function decodeBase64Audio(base64: string): Uint8Array {
  if (!base64) throw new AudioContractError("empty-audio", "Audio was empty");
  if (
    base64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  ) {
    throw new AudioContractError(
      "invalid-base64",
      "Audio was not canonical base64",
    );
  }
  try {
    const binary = atob(base64);
    if (!binary.length)
      throw new AudioContractError("empty-audio", "Audio decoded to no bytes");
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch (error) {
    if (error instanceof AudioContractError) throw error;
    throw new AudioContractError(
      "invalid-base64",
      "Audio base64 could not decode",
    );
  }
}

export function detectAudioEncoding(bytes: Uint8Array): string {
  if (bytes.length >= 12) {
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...bytes.slice(offset, offset + length));
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "wav";
    if (ascii(0, 4) === "fLaC") return "flac";
    if (ascii(0, 4) === "OggS") return "ogg";
  }
  if (bytes.length >= 3 && String.fromCharCode(...bytes.slice(0, 3)) === "ID3")
    return "mp3";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    return "mp3";
  return "unknown";
}

export function validateInworldRouterChunk(
  base64: string,
  declared: DeclaredAudioContract,
): AudioObservation {
  assertDeclaredContract(declared, INWORLD_ROUTER_AUDIO_CONTRACT);
  const bytes = decodeBase64Audio(base64);
  const container = detectAudioEncoding(bytes);
  if (container !== "unknown") {
    throw new AudioContractError(
      "encoding-mismatch",
      `Expected raw PCM, observed ${container}`,
    );
  }
  const bytesPerFrame =
    (INWORLD_ROUTER_AUDIO_CONTRACT.bitsPerSample / 8) * declared.channels;
  if (bytes.byteLength % bytesPerFrame !== 0) {
    throw new AudioContractError(
      "invalid-frame-alignment",
      "PCM bytes did not end on a complete sample frame",
    );
  }
  return {
    declaredEncoding: declared.encoding,
    observedEncoding: INWORLD_ROUTER_AUDIO_CONTRACT.encoding,
    sampleRate: declared.sampleRate,
    channels: declared.channels,
    byteCount: bytes.byteLength,
    frameCount: bytes.byteLength / bytesPerFrame,
  };
}

export function validateInworldStandaloneMP3(
  bytes: Uint8Array,
  contentType: string | null,
  declared: DeclaredAudioContract = INWORLD_STANDALONE_AUDIO_CONTRACT,
): AudioObservation {
  assertDeclaredContract(declared, INWORLD_STANDALONE_AUDIO_CONTRACT);
  if (!bytes.byteLength)
    throw new AudioContractError("empty-audio", "Standalone audio was empty");
  const mediaType = contentType?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== INWORLD_STANDALONE_AUDIO_CONTRACT.contentType) {
    throw new AudioContractError(
      "content-type-mismatch",
      `Expected ${INWORLD_STANDALONE_AUDIO_CONTRACT.contentType}, received ${mediaType || "none"}`,
    );
  }
  const observedEncoding = detectAudioEncoding(bytes);
  if (observedEncoding !== INWORLD_STANDALONE_AUDIO_CONTRACT.encoding) {
    throw new AudioContractError(
      "encoding-mismatch",
      `Expected MP3 bytes, observed ${observedEncoding}`,
    );
  }
  const observed = observeMP3Audio(bytes);
  if (!observed) {
    throw new AudioContractError(
      "encoding-mismatch",
      "MP3 bytes contained no valid MPEG audio frame",
    );
  }
  if (observed.sampleRate !== INWORLD_STANDALONE_AUDIO_CONTRACT.sampleRate) {
    throw new AudioContractError(
      "sample-rate-mismatch",
      `Expected ${INWORLD_STANDALONE_AUDIO_CONTRACT.sampleRate} Hz, observed ${observed.sampleRate} Hz`,
    );
  }
  if (observed.channels !== INWORLD_STANDALONE_AUDIO_CONTRACT.channels) {
    throw new AudioContractError(
      "channel-mismatch",
      `Expected ${INWORLD_STANDALONE_AUDIO_CONTRACT.channels} channel(s), observed ${observed.channels}`,
    );
  }
  return {
    declaredEncoding: declared.encoding,
    observedEncoding,
    sampleRate: observed.sampleRate,
    channels: observed.channels,
    byteCount: bytes.byteLength,
  };
}
