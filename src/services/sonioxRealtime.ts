export const SONIOX_REALTIME_MODEL = "stt-rt-v5" as const;
export const SONIOX_AUDIO_FORMAT = "pcm_s16le" as const;
export const SONIOX_SAMPLE_RATE = 16_000 as const;
export const SONIOX_CHANNELS = 1 as const;
export const SONIOX_BUFFER_DURATION_MS = 100 as const;

export type SonioxToken = {
  text: string;
  is_final: boolean;
  confidence?: number;
  language?: string;
};

export type SonioxMessage = {
  tokens?: SonioxToken[];
  finished?: boolean;
  error_code?: number;
  error_type?: string;
  error_message?: string;
  request_id?: string;
};

export type SonioxTranscriptUpdate = {
  text: string;
  isFinal: boolean;
  confidence: number;
  endpoint: boolean;
  finished: boolean;
  languages: string[];
};

/**
 * Soniox emits finalized tokens exactly once while the current non-final tail
 * is replaced by every response. Keeping those two regions separate avoids
 * duplicating words as a bilingual utterance stabilizes.
 */
export class SonioxTranscriptAccumulator {
  private readonly finalTokens: SonioxToken[] = [];
  private nonFinalTokens: SonioxToken[] = [];

  apply(message: SonioxMessage): SonioxTranscriptUpdate {
    const tokens = message.tokens ?? [];
    let endpoint = false;
    const final = tokens.filter((token) => {
      if (token.text === "<end>") {
        endpoint ||= token.is_final;
        return false;
      }
      return token.is_final;
    });
    const nonFinal = tokens.filter(
      (token) => !token.is_final && token.text !== "<end>",
    );

    this.finalTokens.push(...final);
    this.nonFinalTokens = nonFinal;

    const rendered = [...this.finalTokens, ...this.nonFinalTokens];
    const confidences = rendered
      .map((token) => token.confidence)
      .filter((confidence): confidence is number =>
        Number.isFinite(confidence),
      );
    const languages = [
      ...new Set(
        rendered
          .map((token) => token.language)
          .filter((language): language is string => Boolean(language)),
      ),
    ];

    return {
      text: rendered.map((token) => token.text).join(""),
      isFinal: this.nonFinalTokens.length === 0 && this.finalTokens.length > 0,
      confidence:
        confidences.length > 0
          ? confidences.reduce((total, value) => total + value, 0) /
            confidences.length
          : 0,
      endpoint,
      finished: message.finished === true,
      languages,
    };
  }
}

/** Converts normalized microphone floats into the raw little-endian PCM Soniox expects. */
export function float32ToPCM16(samples: Float32Array): ArrayBuffer {
  const bytes = new ArrayBuffer(samples.length * 2);
  const view = new DataView(bytes);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(
      index * 2,
      sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff),
      true,
    );
  }
  return bytes;
}

/** Matches the existing 0...1 metering contract used by the turn-taking engine. */
export function normalizedAudioEnergy(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumOfSquares = 0;
  for (const sample of samples) sumOfSquares += sample * sample;
  return Math.max(0, Math.min(1, Math.sqrt(sumOfSquares / samples.length) * 8));
}
