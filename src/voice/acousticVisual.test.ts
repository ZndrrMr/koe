import assert from "node:assert/strict";
import test from "node:test";
import {
  ACOUSTIC_PRESENTATION,
  advanceEnergyTrace,
  INITIAL_ENERGY_TRACE,
  voiceSeamPaths,
} from "./acousticVisual";

test("muted lifecycle states retain distinct visible meanings", () => {
  assert.equal(ACOUSTIC_PRESENTATION.listening.shape, "open");
  assert.equal(ACOUSTIC_PRESENTATION.understanding.shape, "compressed");
  assert.equal(ACOUSTIC_PRESENTATION.speaking.shape, "open");
  assert.notEqual(
    ACOUSTIC_PRESENTATION.listening.eyebrow,
    ACOUSTIC_PRESENTATION.speaking.eyebrow,
  );
  assert.equal(ACOUSTIC_PRESENTATION.transcriptCheck.shape, "split");
  assert.equal(ACOUSTIC_PRESENTATION.feedback.shape, "split");
  assert.equal(ACOUSTIC_PRESENTATION.retryListening.shape, "open");
  assert.equal(ACOUSTIC_PRESENTATION.comparing.shape, "comparing");
  assert.equal(ACOUSTIC_PRESENTATION.responseRetry.shape, "answering");
  assert.equal(ACOUSTIC_PRESENTATION.interrupted.shape, "broken");
  assert.equal(ACOUSTIC_PRESENTATION.success.shape, "resolved");
});

test("live trace width follows measured energy and non-live states decay", () => {
  const quiet = advanceEnergyTrace(INITIAL_ENERGY_TRACE, "listening", 0.05);
  const loud = advanceEnergyTrace(quiet, "listening", 0.9);
  const compressed = advanceEnergyTrace(loud, "understanding", 0.9);

  assert.ok(loud.at(-1)! > quiet.at(-1)!);
  assert.ok(compressed.every((sample, index) => sample <= loud[index]));
});

test("voice seam geometry is finite and preserves energy differences", () => {
  const quiet = voiceSeamPaths(Array(15).fill(0.05), {
    width: 240,
    height: 320,
  });
  const loud = voiceSeamPaths(Array(15).fill(0.8), {
    width: 240,
    height: 320,
  });

  assert.equal(quiet.envelope.includes("NaN"), false);
  assert.equal(loud.center.includes("NaN"), false);
  assert.ok(Math.max(...loud.halfWidths) > Math.max(...quiet.halfWidths));
});
