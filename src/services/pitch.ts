import { PitchDetector } from "pitchy";

import { log } from "@/utils/log";

export type PitchContour = {
  f0: number[];
  timestamps: number[];
  rms: number[];
  voicedRatio: number;
  durationMs: number;
};

export type PcmAudio = {
  samples: Float32Array;
  sampleRate: number;
};

export type DecodedAudioBuffer = {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData: (channel: number) => Float32Array;
};

export type SpeechUnitMeasurement = {
  unit: string;
  index: number;
  referenceStartMs: number;
  referenceEndMs: number;
  attemptStartMs: number;
  attemptEndMs: number;
  referencePitchSemitones: number | null;
  attemptPitchSemitones: number | null;
  referenceVoicedRatio: number;
  attemptVoicedRatio: number;
  durationRatio: number;
  pitchScore: number;
  timingScore: number;
  voicingScore: number;
  score: number;
};

export type PronunciationTarget = {
  unit: string;
  unitIndex: number;
  dimension: "pitch" | "timing" | "voicing";
  score: number;
};

export type PronunciationFeedback = {
  version: 1;
  status: "aligned" | "insufficient-audio" | "alignment-failed";
  targetText: string;
  units: SpeechUnitMeasurement[];
  reference: PitchContour;
  attempt: PitchContour;
  alignmentPath: Array<[number, number]>;
  scores: {
    pitch: number;
    timing: number;
    voicing: number;
    overall: number;
  };
  firstCorrection: string;
  target?: PronunciationTarget;
  retry?: {
    previousAttemptId: string;
    scoreDelta: number;
    targetScoreDelta: number;
    targetImproved: boolean;
  };
};

export type PronunciationAnalysisInput = {
  targetText: string;
  targetReading?: string;
  referenceAudioUri: string;
  attemptAudioUri: string;
  previous?: { attemptId: string; feedback: PronunciationFeedback };
};

type ContourInput = Pick<PitchContour, "f0" | "timestamps"> &
  Partial<Pick<PitchContour, "rms" | "voicedRatio" | "durationMs">>;

const ANALYSIS_SAMPLE_RATE = 16_000;
const WINDOW_SIZE = 1_024;
const HOP_MS = 10;
const MIN_CLARITY = 0.78;
const MIN_PITCH_HZ = 55;
const MAX_PITCH_HZ = 500;
const MIN_SPEECH_MS = 120;

/**
 * Decode any format supported by the native audio stack (including the M4A
 * recordings and MP3 TTS files Koe already creates), resample to 16 kHz, and
 * downmix to mono before analysis.
 */
export async function decodeAudioToPcm(
  audioUri: string,
  decoder: (
    uri: string,
    sampleRate: number,
  ) => Promise<DecodedAudioBuffer> = decodeWithNativeAudioApi,
): Promise<PcmAudio> {
  if (!audioUri) throw new Error("Audio URI is empty");
  const decoded = await decoder(audioUri, ANALYSIS_SAMPLE_RATE);
  if (
    !decoded.length ||
    !decoded.numberOfChannels ||
    !Number.isFinite(decoded.sampleRate) ||
    decoded.sampleRate <= 0
  ) {
    throw new Error("Decoded audio contains no PCM samples");
  }

  const samples = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
    const channelData = decoded.getChannelData(channel);
    const length = Math.min(samples.length, channelData.length);
    for (let index = 0; index < length; index += 1) {
      samples[index] += channelData[index] / decoded.numberOfChannels;
    }
  }
  return { samples, sampleRate: decoded.sampleRate };
}

async function decodeWithNativeAudioApi(
  uri: string,
  sampleRate: number,
): Promise<DecodedAudioBuffer> {
  // Keep the native module behind the async boundary so pure signal tests can
  // run in Node without loading a TurboModule.
  const { decodeAudioData } = await import("react-native-audio-api");
  return decodeAudioData(uri, sampleRate);
}

export async function extractContour(audioUri: string): Promise<PitchContour> {
  try {
    const { samples, sampleRate } = await decodeAudioToPcm(audioUri);
    return extractFromPcm(samples, sampleRate);
  } catch (error) {
    log.warn("extractContour failed", error);
    return emptyContour();
  }
}

export function extractFromPcm(
  samples: Float32Array,
  sampleRate: number,
): PitchContour {
  if (!samples.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return emptyContour();
  }

  const hopSize = Math.max(1, Math.round((HOP_MS / 1_000) * sampleRate));
  const detector = PitchDetector.forFloat32Array(WINDOW_SIZE);
  detector.minVolumeDecibels = -42;
  const durationMs = (samples.length / sampleRate) * 1_000;
  const f0: number[] = [];
  const timestamps: number[] = [];
  const rms: number[] = [];
  let voicedFrames = 0;

  const frameCount = Math.max(
    1,
    Math.floor(Math.max(0, samples.length - WINDOW_SIZE) / hopSize) + 1,
  );
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const offset = frameIndex * hopSize;
    const available = Math.max(
      0,
      Math.min(WINDOW_SIZE, samples.length - offset),
    );
    const frame = new Float32Array(WINDOW_SIZE);
    if (available) frame.set(samples.subarray(offset, offset + available));

    let sumSquares = 0;
    for (let index = 0; index < available; index += 1) {
      sumSquares += frame[index] * frame[index];
    }
    const frameRms = available ? Math.sqrt(sumSquares / available) : 0;
    const [pitch, clarity] = detector.findPitch(frame, sampleRate);
    const isVoiced =
      frameRms >= 0.003 &&
      clarity >= MIN_CLARITY &&
      pitch >= MIN_PITCH_HZ &&
      pitch <= MAX_PITCH_HZ;

    f0.push(isVoiced ? pitch : -1);
    rms.push(frameRms);
    timestamps.push(Math.min(durationMs, (offset / sampleRate) * 1_000));
    if (isVoiced) voicedFrames += 1;
  }

  return {
    f0,
    timestamps,
    rms,
    voicedRatio: f0.length ? voicedFrames / f0.length : 0,
    durationMs,
  };
}

export async function analyzePronunciation(
  input: PronunciationAnalysisInput,
): Promise<PronunciationFeedback> {
  const [reference, attempt] = await Promise.all([
    extractContour(input.referenceAudioUri),
    extractContour(input.attemptAudioUri),
  ]);
  const measured = analyzePronunciationContours(
    input.targetReading ?? input.targetText,
    reference,
    attempt,
  );
  const result = { ...measured, targetText: input.targetText };
  return input.previous
    ? withRetryComparison(
        result,
        input.previous.attemptId,
        input.previous.feedback,
      )
    : result;
}

export function analyzePronunciationContours(
  targetText: string,
  referenceInput: ContourInput,
  attemptInput: ContourInput,
): PronunciationFeedback {
  const reference = completeContour(referenceInput);
  const attempt = completeContour(attemptInput);
  const units = segmentJapaneseMora(targetText);
  const referenceSpeech = speechFrameRange(reference);
  const attemptSpeech = speechFrameRange(attempt);

  if (
    !units.length ||
    !referenceSpeech ||
    !attemptSpeech ||
    speechDuration(reference, referenceSpeech) < MIN_SPEECH_MS ||
    speechDuration(attempt, attemptSpeech) < MIN_SPEECH_MS
  ) {
    return failedFeedback(
      "insufficient-audio",
      targetText,
      reference,
      attempt,
      "Say the whole phrase once, keeping the microphone about a hand-width away.",
    );
  }

  const speechLengthRatio =
    speechDuration(attempt, attemptSpeech) /
    speechDuration(reference, referenceSpeech);
  if (speechLengthRatio < 0.25 || speechLengthRatio > 4) {
    return failedFeedback(
      "alignment-failed",
      targetText,
      reference,
      attempt,
      "Match the reference pace first, then keep each sound in the same order.",
    );
  }

  const referenceIndices = range(referenceSpeech.start, referenceSpeech.end);
  const attemptIndices = range(attemptSpeech.start, attemptSpeech.end);
  const aligned = alignContourFrames(
    reference,
    attempt,
    referenceIndices,
    attemptIndices,
  );
  if (!aligned.path.length || !Number.isFinite(aligned.distance)) {
    return failedFeedback(
      "alignment-failed",
      targetText,
      reference,
      attempt,
      "Match the reference pace first, then keep each sound in the same order.",
    );
  }

  const referenceCenter = median(reference.f0.filter((value) => value > 0));
  const attemptCenter = median(attempt.f0.filter((value) => value > 0));
  const measurements = measureUnits({
    units,
    reference,
    attempt,
    referenceSpeech,
    alignmentPath: aligned.path,
    referenceCenter,
    attemptCenter,
  });
  if (!measurements.length) {
    return failedFeedback(
      "alignment-failed",
      targetText,
      reference,
      attempt,
      "Match the reference pace first, then keep each sound in the same order.",
    );
  }

  const scores = {
    pitch: average(measurements.map((unit) => unit.pitchScore)),
    timing: average(measurements.map((unit) => unit.timingScore)),
    voicing: average(measurements.map((unit) => unit.voicingScore)),
    overall: average(measurements.map((unit) => unit.score)),
  };
  const target = selectTarget(measurements);

  return {
    version: 1,
    status: "aligned",
    targetText,
    units: measurements,
    reference,
    attempt,
    alignmentPath: aligned.path,
    scores: mapRounded(scores),
    firstCorrection: correctionForTarget(
      target,
      measurements[target.unitIndex],
    ),
    target,
  };
}

export function withRetryComparison(
  current: PronunciationFeedback,
  previousAttemptId: string,
  previous: PronunciationFeedback,
): PronunciationFeedback {
  if (current.status !== "aligned" || previous.status !== "aligned") {
    return current;
  }
  const target = previous.target ?? current.target;
  if (!target) return current;
  const previousUnit = previous.units[target.unitIndex];
  const currentUnit = current.units[target.unitIndex];
  if (!previousUnit || !currentUnit) return current;
  const previousTargetScore = dimensionScore(previousUnit, target.dimension);
  const currentTargetScore = dimensionScore(currentUnit, target.dimension);

  return {
    ...current,
    retry: {
      previousAttemptId,
      scoreDelta: current.scores.overall - previous.scores.overall,
      targetScoreDelta: currentTargetScore - previousTargetScore,
      targetImproved: currentTargetScore >= previousTargetScore + 2,
    },
  };
}

export function segmentJapaneseMora(text: string): string[] {
  const cleaned = text
    .normalize("NFKC")
    .replace(/[\s、。！？!?「」『』（）()・,.]/gu, "");
  const units: string[] = [];
  for (const character of Array.from(cleaned)) {
    if (/^[ゃゅょャュョぁぃぅぇぉァィゥェォゎヮヵヶ]$/u.test(character)) {
      if (units.length) units[units.length - 1] += character;
      else units.push(character);
    } else if (/^[\u3099\u309a]$/u.test(character) && units.length) {
      units[units.length - 1] += character;
    } else {
      units.push(character);
    }
  }
  return units;
}

export function compareContours(
  native: ContourInput,
  user: ContourInput,
): {
  dtwDistance: number;
  normalizedScore: number;
  alignmentPath: Array<[number, number]>;
} {
  const reference = completeContour(native);
  const attempt = completeContour(user);
  const referenceSpeech = speechFrameRange(reference);
  const attemptSpeech = speechFrameRange(attempt);
  if (!referenceSpeech || !attemptSpeech) {
    return { dtwDistance: Infinity, normalizedScore: 0, alignmentPath: [] };
  }
  const result = alignContourFrames(
    reference,
    attempt,
    range(referenceSpeech.start, referenceSpeech.end),
    range(attemptSpeech.start, attemptSpeech.end),
  );
  const normalized = result.distance / Math.max(1, result.path.length);
  return {
    dtwDistance: result.distance,
    normalizedScore: clampScore(100 - normalized * 8),
    alignmentPath: result.path,
  };
}

function completeContour(input: ContourInput): PitchContour {
  const rms =
    input.rms?.length === input.f0.length
      ? input.rms
      : input.f0.map((value) => (value > 0 ? 0.1 : 0));
  const voiced = input.f0.filter((value) => value > 0).length;
  const lastTimestamp = input.timestamps[input.timestamps.length - 1] ?? 0;
  const hop =
    input.timestamps.length > 1
      ? input.timestamps[1] - input.timestamps[0]
      : HOP_MS;
  return {
    f0: [...input.f0],
    timestamps: [...input.timestamps],
    rms: [...rms],
    voicedRatio:
      input.voicedRatio ?? (input.f0.length ? voiced / input.f0.length : 0),
    durationMs: input.durationMs ?? lastTimestamp + hop,
  };
}

function emptyContour(): PitchContour {
  return {
    f0: [],
    timestamps: [],
    rms: [],
    voicedRatio: 0,
    durationMs: 0,
  };
}

function failedFeedback(
  status: PronunciationFeedback["status"],
  targetText: string,
  reference: PitchContour,
  attempt: PitchContour,
  firstCorrection: string,
): PronunciationFeedback {
  return {
    version: 1,
    status,
    targetText,
    units: [],
    reference,
    attempt,
    alignmentPath: [],
    scores: { pitch: 0, timing: 0, voicing: 0, overall: 0 },
    firstCorrection,
  };
}

function speechFrameRange(
  contour: PitchContour,
): { start: number; end: number } | null {
  if (!contour.f0.length) return null;
  const peak = Math.max(0, ...contour.rms);
  const threshold = Math.max(0.0025, peak * 0.06);
  const speechIndices = contour.rms
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value >= threshold)
    .map(({ index }) => index);
  if (!speechIndices.length) return null;
  return {
    start: Math.max(0, speechIndices[0] - 1),
    end: Math.min(contour.f0.length - 1, speechIndices.at(-1)! + 1),
  };
}

function speechDuration(
  contour: PitchContour,
  speech: { start: number; end: number },
): number {
  return Math.max(
    HOP_MS,
    (contour.timestamps[speech.end] ?? 0) -
      (contour.timestamps[speech.start] ?? 0) +
      HOP_MS,
  );
}

function alignContourFrames(
  reference: PitchContour,
  attempt: PitchContour,
  referenceIndices: number[],
  attemptIndices: number[],
): { distance: number; path: Array<[number, number]> } {
  if (!referenceIndices.length || !attemptIndices.length) {
    return { distance: Infinity, path: [] };
  }
  const referenceCenter = median(reference.f0.filter((value) => value > 0));
  const attemptCenter = median(attempt.f0.filter((value) => value > 0));
  const rows = referenceIndices.length;
  const columns = attemptIndices.length;
  const matrix = Array.from({ length: rows + 1 }, () =>
    new Float64Array(columns + 1).fill(Infinity),
  );
  matrix[0][0] = 0;

  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const referenceIndex = referenceIndices[row - 1];
      const attemptIndex = attemptIndices[column - 1];
      const cost = frameCost(
        reference,
        attempt,
        referenceIndex,
        attemptIndex,
        referenceCenter,
        attemptCenter,
      );
      matrix[row][column] =
        cost +
        Math.min(
          matrix[row - 1][column - 1],
          matrix[row - 1][column] + 0.2,
          matrix[row][column - 1] + 0.2,
        );
    }
  }

  const path: Array<[number, number]> = [];
  let row = rows;
  let column = columns;
  while (row > 0 && column > 0) {
    path.push([referenceIndices[row - 1], attemptIndices[column - 1]]);
    const diagonal = matrix[row - 1][column - 1];
    const up = matrix[row - 1][column] + 0.2;
    const left = matrix[row][column - 1] + 0.2;
    if (diagonal <= up && diagonal <= left) {
      row -= 1;
      column -= 1;
    } else if (up <= left) {
      row -= 1;
    } else {
      column -= 1;
    }
  }
  return { distance: matrix[rows][columns], path: path.reverse() };
}

function frameCost(
  reference: PitchContour,
  attempt: PitchContour,
  referenceIndex: number,
  attemptIndex: number,
  referenceCenter: number,
  attemptCenter: number,
): number {
  const referencePitch = reference.f0[referenceIndex];
  const attemptPitch = attempt.f0[attemptIndex];
  const referenceVoiced = referencePitch > 0;
  const attemptVoiced = attemptPitch > 0;
  let pitchCost = 0;
  if (referenceVoiced && attemptVoiced) {
    const referenceSemi = 12 * Math.log2(referencePitch / referenceCenter);
    const attemptSemi = 12 * Math.log2(attemptPitch / attemptCenter);
    pitchCost = Math.min(12, Math.abs(referenceSemi - attemptSemi));
  } else if (referenceVoiced !== attemptVoiced) {
    pitchCost = 7;
  }
  const referenceEnergy = reference.rms[referenceIndex] ?? 0;
  const attemptEnergy = attempt.rms[attemptIndex] ?? 0;
  const energyCost =
    Math.abs(
      Math.log10(referenceEnergy + 0.001) - Math.log10(attemptEnergy + 0.001),
    ) * 1.5;
  return pitchCost + energyCost;
}

function measureUnits(input: {
  units: string[];
  reference: PitchContour;
  attempt: PitchContour;
  referenceSpeech: { start: number; end: number };
  alignmentPath: Array<[number, number]>;
  referenceCenter: number;
  attemptCenter: number;
}): SpeechUnitMeasurement[] {
  const frameSpan = input.referenceSpeech.end - input.referenceSpeech.start + 1;
  return input.units.map((unit, index) => {
    const unitStart =
      input.referenceSpeech.start +
      Math.floor((index / input.units.length) * frameSpan);
    const unitEnd = Math.min(
      input.referenceSpeech.end,
      input.referenceSpeech.start +
        Math.floor(((index + 1) / input.units.length) * frameSpan) -
        1,
    );
    const relevantPairs = input.alignmentPath.filter(
      ([referenceIndex]) =>
        referenceIndex >= unitStart && referenceIndex <= unitEnd,
    );
    const attemptIndices = relevantPairs.map(
      ([, attemptIndex]) => attemptIndex,
    );
    const attemptStart = attemptIndices.length
      ? Math.min(...attemptIndices)
      : 0;
    const attemptEnd = attemptIndices.length ? Math.max(...attemptIndices) : 0;
    const referenceFrameIndices = range(unitStart, unitEnd);
    const referencePitches = referenceFrameIndices
      .map((frame) => input.reference.f0[frame])
      .filter((pitch) => pitch > 0);
    const attemptPitches = attemptIndices
      .map((frame) => input.attempt.f0[frame])
      .filter((pitch) => pitch > 0);
    const referenceRelativePitch = relativePitch(
      referencePitches,
      input.referenceCenter,
    );
    const attemptRelativePitch = relativePitch(
      attemptPitches,
      input.attemptCenter,
    );
    const referenceVoicedRatio = referenceFrameIndices.length
      ? referencePitches.length / referenceFrameIndices.length
      : 0;
    const attemptVoicedRatio = attemptIndices.length
      ? attemptPitches.length / attemptIndices.length
      : 0;
    const referenceDuration = Math.max(
      HOP_MS,
      (input.reference.timestamps[unitEnd] ?? 0) -
        (input.reference.timestamps[unitStart] ?? 0) +
        HOP_MS,
    );
    const attemptDuration = Math.max(
      HOP_MS,
      (input.attempt.timestamps[attemptEnd] ?? 0) -
        (input.attempt.timestamps[attemptStart] ?? 0) +
        HOP_MS,
    );
    const durationRatio = attemptDuration / referenceDuration;
    const pitchDifference =
      referenceRelativePitch === null || attemptRelativePitch === null
        ? referenceRelativePitch === attemptRelativePitch
          ? 0
          : 6
        : Math.abs(referenceRelativePitch - attemptRelativePitch);
    const pitchScore = clampScore(100 - pitchDifference * 14);
    const timingScore = clampScore(
      100 - Math.abs(Math.log2(durationRatio)) * 72,
    );
    const voicingScore = clampScore(
      100 - Math.abs(referenceVoicedRatio - attemptVoicedRatio) * 130,
    );
    const score = pitchScore * 0.5 + timingScore * 0.3 + voicingScore * 0.2;

    return {
      unit,
      index,
      referenceStartMs: round(input.reference.timestamps[unitStart] ?? 0, 1),
      referenceEndMs: round(
        (input.reference.timestamps[unitEnd] ?? 0) + HOP_MS,
        1,
      ),
      attemptStartMs: round(input.attempt.timestamps[attemptStart] ?? 0, 1),
      attemptEndMs: round(
        (input.attempt.timestamps[attemptEnd] ?? 0) + HOP_MS,
        1,
      ),
      referencePitchSemitones: nullableRound(referenceRelativePitch, 2),
      attemptPitchSemitones: nullableRound(attemptRelativePitch, 2),
      referenceVoicedRatio: round(referenceVoicedRatio, 3),
      attemptVoicedRatio: round(attemptVoicedRatio, 3),
      durationRatio: round(durationRatio, 3),
      pitchScore: Math.round(pitchScore),
      timingScore: Math.round(timingScore),
      voicingScore: Math.round(voicingScore),
      score: Math.round(score),
    };
  });
}

function selectTarget(units: SpeechUnitMeasurement[]): PronunciationTarget {
  let selected: PronunciationTarget = {
    unit: units[0].unit,
    unitIndex: 0,
    dimension: "pitch",
    score: units[0].pitchScore,
  };
  for (const unit of units) {
    const dimensions: PronunciationTarget["dimension"][] = [
      "pitch",
      "timing",
      "voicing",
    ];
    for (const dimension of dimensions) {
      const score = dimensionScore(unit, dimension);
      if (score < selected.score) {
        selected = { unit: unit.unit, unitIndex: unit.index, dimension, score };
      }
    }
  }
  return selected;
}

function correctionForTarget(
  target: PronunciationTarget,
  unit: SpeechUnitMeasurement,
): string {
  if (target.dimension === "timing") {
    return unit.durationRatio > 1
      ? `Shorten 「${unit.unit}」 and move into the next sound sooner.`
      : `Hold 「${unit.unit}」 a little longer before the next sound.`;
  }
  if (target.dimension === "voicing") {
    return unit.attemptVoicedRatio < unit.referenceVoicedRatio
      ? `Keep your voice ringing through 「${unit.unit}」 instead of letting it fade.`
      : `Make 「${unit.unit}」 lighter; the reference briefly releases the voice there.`;
  }
  const referencePitch = unit.referencePitchSemitones ?? 0;
  const attemptPitch = unit.attemptPitchSemitones ?? 0;
  const amount = Math.max(
    1,
    Math.round(Math.abs(referencePitch - attemptPitch)),
  );
  return attemptPitch > referencePitch
    ? `On 「${unit.unit}」, lower your voice about ${amount} ${amount === 1 ? "step" : "steps"}.`
    : `On 「${unit.unit}」, lift your voice about ${amount} ${amount === 1 ? "step" : "steps"}.`;
}

function dimensionScore(
  unit: SpeechUnitMeasurement,
  dimension: PronunciationTarget["dimension"],
): number {
  if (dimension === "timing") return unit.timingScore;
  if (dimension === "voicing") return unit.voicingScore;
  return unit.pitchScore;
}

function relativePitch(values: number[], center: number): number | null {
  if (!values.length || !center) return null;
  return 12 * Math.log2(median(values) / center);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function range(start: number, end: number): number[] {
  if (end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function average(values: number[]): number {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function mapRounded<T extends Record<string, number>>(values: T): T {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, Math.round(value)]),
  ) as T;
}

function nullableRound(value: number | null, precision: number): number | null {
  return value === null ? null : round(value, precision);
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
