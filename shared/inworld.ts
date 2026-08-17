/**
 * The one Koe V1 voice and the provider contracts observed/documented for it.
 *
 * Inworld Router voice responses are raw signed 16-bit little-endian PCM at
 * 48 kHz mono. The standalone TTS endpoint is deliberately requested as MP3
 * at 24 kHz mono. Keeping these values together makes disagreement between
 * app, Worker, fixtures, and product policy a testable build failure.
 */
export const KOE_V1_VOICE_ID = "Asuka" as const;

/**
 * Let Inworld choose from models that are currently available instead of
 * pinning Koe to a provider model ID that can disappear independently of an
 * app release. The voice remains fixed and is applied after model routing.
 */
export const KOE_V1_ROUTER_MODEL = "auto" as const;

export const INWORLD_ROUTER_AUDIO_CONTRACT = {
  encoding: "pcm_s16le",
  sampleRate: 48_000,
  channels: 1,
  bitsPerSample: 16,
} as const;

export const INWORLD_STANDALONE_AUDIO_CONTRACT = {
  encoding: "mp3",
  sampleRate: 24_000,
  channels: 1,
  contentType: "audio/mpeg",
} as const;

export type InworldAudioEncoding =
  | typeof INWORLD_ROUTER_AUDIO_CONTRACT.encoding
  | typeof INWORLD_STANDALONE_AUDIO_CONTRACT.encoding;

export type DeclaredAudioContract = {
  encoding: string;
  sampleRate: number;
  channels: number;
};

export type MP3AudioObservation = {
  sampleRate: number;
  channels: number;
};

/** Reads the first valid MPEG audio frame rather than trusting HTTP metadata. */
export function observeMP3Audio(
  bytes: Uint8Array,
): MP3AudioObservation | undefined {
  let offset = 0;
  if (
    bytes.length >= 10 &&
    bytes[0] === 0x49 &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x33
  ) {
    const tagSize =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);
    offset = 10 + tagSize + (bytes[5] & 0x10 ? 10 : 0);
  }

  for (; offset + 3 < bytes.length; offset += 1) {
    const second = bytes[offset + 1];
    const third = bytes[offset + 2];
    if (bytes[offset] !== 0xff || (second & 0xe0) !== 0xe0) continue;
    const versionBits = (second >> 3) & 0x03;
    const layerBits = (second >> 1) & 0x03;
    const bitrateIndex = (third >> 4) & 0x0f;
    const sampleRateIndex = (third >> 2) & 0x03;
    if (
      versionBits === 0x01 ||
      layerBits === 0 ||
      bitrateIndex === 0 ||
      bitrateIndex === 0x0f ||
      sampleRateIndex === 0x03
    ) {
      continue;
    }
    const mpeg1Rate = [44_100, 48_000, 32_000][sampleRateIndex];
    const divisor = versionBits === 0x03 ? 1 : versionBits === 0x02 ? 2 : 4;
    return {
      sampleRate: mpeg1Rate / divisor,
      channels: bytes[offset + 3] >> 6 === 0x03 ? 1 : 2,
    };
  }
  return undefined;
}
