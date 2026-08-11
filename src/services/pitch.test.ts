import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzePronunciationContours,
  decodeAudioToPcm,
  extractFromPcm,
  segmentJapaneseMora,
  withRetryComparison,
  type PitchContour,
} from "./pitch";

test("decodeAudioToPcm uses the native format decoder for M4A and MP3 and downmixes PCM", async () => {
  const calls: Array<{ uri: string; sampleRate: number }> = [];
  const decoder = async (uri: string, sampleRate: number) => {
    calls.push({ uri, sampleRate });
    return {
      numberOfChannels: 2,
      sampleRate,
      length: 3,
      getChannelData: (channel: number) =>
        channel === 0
          ? new Float32Array([1, 0.5, -0.5])
          : new Float32Array([-1, 0.5, 0.5]),
    };
  };

  const m4a = await decodeAudioToPcm("file:///attempt.m4a", decoder);
  const mp3 = await decodeAudioToPcm("file:///reference.mp3", decoder);

  assert.deepEqual(calls, [
    { uri: "file:///attempt.m4a", sampleRate: 16_000 },
    { uri: "file:///reference.mp3", sampleRate: 16_000 },
  ]);
  assert.deepEqual(Array.from(m4a.samples), [0, 0.5, 0]);
  assert.deepEqual(Array.from(mp3.samples), [0, 0.5, 0]);
});

test("extractFromPcm treats silence as unvoiced without inventing pitch", () => {
  const contour = extractFromPcm(new Float32Array(16_000), 16_000);

  assert.ok(contour.f0.length > 0);
  assert.equal(contour.voicedRatio, 0);
  assert.ok(contour.f0.every((pitch) => pitch === -1));
});

test("extractFromPcm preserves unvoiced regions between voiced sounds", () => {
  const sampleRate = 16_000;
  const samples = new Float32Array(sampleRate);
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    const voiced = time < 0.3 || time > 0.7;
    samples[index] = voiced
      ? Math.sin(2 * Math.PI * (time < 0.3 ? 170 : 220) * time) * 0.3
      : 0;
  }

  const contour = extractFromPcm(samples, sampleRate);

  assert.ok(contour.f0.some((pitch) => pitch > 0));
  assert.ok(contour.f0.some((pitch) => pitch === -1));
  assert.ok(contour.voicedRatio > 0.2 && contour.voicedRatio < 0.8);
});

test("extractFromPcm returns deterministic data for a clip shorter than one window", () => {
  const samples = new Float32Array(160);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * 190 * index) / 16_000) * 0.2;
  }

  const contour = extractFromPcm(samples, 16_000);

  assert.equal(contour.f0.length, 1);
  assert.equal(contour.timestamps[0], 0);
  assert.equal(contour.durationMs, 10);
});

test("alignment failure gives a concrete pace correction for a gross duration mismatch", () => {
  const reference = contourFromUnits([
    { pitch: 180, frames: 10 },
    { pitch: 220, frames: 10 },
  ]);
  const attempt = contourFromUnits([
    { pitch: 180, frames: 60 },
    { pitch: 220, frames: 60 },
  ]);

  const feedback = analyzePronunciationContours("はし", reference, attempt);

  assert.equal(feedback.status, "alignment-failed");
  assert.match(feedback.firstCorrection, /pace/);
  assert.deepEqual(feedback.alignmentPath, []);
});

test("a known-good transposed Japanese pattern scores above a reversed poor attempt", () => {
  const reference = contourFromUnits([
    { pitch: 170, frames: 12 },
    { pitch: 230, frames: 12 },
    { pitch: 205, frames: 12 },
  ]);
  // Same relative pattern in a different vocal range.
  const good = contourFromUnits([
    { pitch: 220, frames: 12 },
    { pitch: 298, frames: 12 },
    { pitch: 265, frames: 12 },
  ]);
  const poor = contourFromUnits([
    { pitch: 300, frames: 12 },
    { pitch: 205, frames: 12 },
    { pitch: 230, frames: 12 },
  ]);

  const goodFeedback = analyzePronunciationContours("おはよ", reference, good);
  const poorFeedback = analyzePronunciationContours("おはよ", reference, poor);

  assert.equal(goodFeedback.status, "aligned");
  assert.equal(poorFeedback.status, "aligned");
  assert.ok(
    goodFeedback.scores.overall >= poorFeedback.scores.overall + 20,
    `${goodFeedback.scores.overall} should clearly beat ${poorFeedback.scores.overall}`,
  );
  assert.match(poorFeedback.firstCorrection, /「[おはよ]」/u);
  assert.match(poorFeedback.firstCorrection, /(lift|lower|Shorten|Hold)/);
});

test("representative Japanese mora timing and devoicing are measured per unit", () => {
  const reference = contourFromUnits([
    { pitch: 205, frames: 8 },
    { pitch: -1, frames: 5 },
    { pitch: 245, frames: 12 },
  ]);
  const attempt = contourFromUnits([
    { pitch: 205, frames: 12 },
    { pitch: 205, frames: 11 },
    { pitch: 245, frames: 6 },
  ]);

  const feedback = analyzePronunciationContours("きって", reference, attempt);

  assert.equal(feedback.status, "aligned");
  assert.equal(feedback.units.length, 3);
  assert.ok(feedback.scores.timing < 100);
  assert.ok(feedback.scores.voicing < 100);
  assert.ok(feedback.units.some((unit) => unit.voicingScore < 80));
});

test("retry comparison reports whether the previous actionable target improved", () => {
  const reference = contourFromUnits([
    { pitch: 170, frames: 10 },
    { pitch: 240, frames: 10 },
  ]);
  const poor = analyzePronunciationContours(
    "はし",
    reference,
    contourFromUnits([
      { pitch: 260, frames: 10 },
      { pitch: 180, frames: 10 },
    ]),
  );
  const better = analyzePronunciationContours(
    "はし",
    reference,
    contourFromUnits([
      { pitch: 180, frames: 10 },
      { pitch: 230, frames: 10 },
    ]),
  );

  const compared = withRetryComparison(better, "attempt-1", poor);

  assert.equal(compared.retry?.previousAttemptId, "attempt-1");
  assert.equal(compared.retry?.targetImproved, true);
  assert.ok((compared.retry?.targetScoreDelta ?? 0) > 0);
});

test("Japanese segmentation keeps contracted sounds together and counts sokuon", () => {
  assert.deepEqual(segmentJapaneseMora("きょう、がっこう"), [
    "きょ",
    "う",
    "が",
    "っ",
    "こ",
    "う",
  ]);
});

function contourFromUnits(
  units: Array<{ pitch: number; frames: number }>,
): PitchContour {
  const f0 = units.flatMap((unit) => Array(unit.frames).fill(unit.pitch));
  return {
    f0,
    timestamps: f0.map((_, index) => index * 10),
    rms: f0.map(() => 0.12),
    voicedRatio: f0.filter((pitch) => pitch > 0).length / f0.length,
    durationMs: f0.length * 10,
  };
}
