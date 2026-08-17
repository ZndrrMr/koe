export const HANDS_FREE_ENDPOINT = {
  /** Give a learner time to think before the first sound. */
  initialSilenceMs: 8_000,
  /** Ordinary pause after an interim transcript. */
  interimSilenceMs: 1_600,
  /** Fillers and self-corrections need a wider pause window. */
  hesitationSilenceMs: 2_600,
  /** Native speech-end is a strong signal, but leaves room for a restart. */
  speechEndGraceMs: 550,
  /** A provider final result is the strongest endpoint signal. */
  finalResultGraceMs: 300,
  /** Avoid turning a tap, cough, or audio-session warmup into a turn. */
  minimumCaptureMs: 400,
  /** Prevent an abandoned recognizer from owning the microphone forever. */
  maximumUtteranceMs: 120_000,
  /** Normalized speech-recognizer metering floor. */
  audibleEnergy: 0.06,
  /** Let the audio session settle before an automatic no-speech retry. */
  noSpeechRetryMs: 350,
} as const;

const HESITATION_ENDING =
  /(?:えー+|ええと|えっと|あの+|その+|まあ|なんか|つまり|let me|well|um+|uh+)[\s、,.…]*$/iu;

export type EndpointSignal = "interim" | "final" | "speechEnd";

export function endpointDelayMs(signal: EndpointSignal, transcript = "") {
  if (signal === "final") return HANDS_FREE_ENDPOINT.finalResultGraceMs;
  if (signal === "speechEnd") return HANDS_FREE_ENDPOINT.speechEndGraceMs;
  return HESITATION_ENDING.test(transcript.trim())
    ? HANDS_FREE_ENDPOINT.hesitationSilenceMs
    : HANDS_FREE_ENDPOINT.interimSilenceMs;
}
