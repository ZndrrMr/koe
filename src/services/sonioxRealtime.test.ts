import assert from "node:assert/strict";
import test from "node:test";

import {
  float32ToPCM16,
  normalizedAudioEnergy,
  SonioxTranscriptAccumulator,
} from "./sonioxRealtime";

test("bilingual token updates remain ordered without duplicating provisional text", () => {
  const transcript = new SonioxTranscriptAccumulator();

  assert.deepEqual(
    transcript.apply({
      tokens: [
        { text: "今日は", is_final: true, confidence: 0.98, language: "ja" },
        { text: " a", is_final: false, confidence: 0.75, language: "en" },
      ],
    }),
    {
      text: "今日は a",
      isFinal: false,
      confidence: 0.865,
      endpoint: false,
      finished: false,
      languages: ["ja", "en"],
    },
  );

  const refined = transcript.apply({
    tokens: [
      { text: " a", is_final: true, confidence: 0.91, language: "en" },
      { text: " busy day", is_final: false, confidence: 0.89, language: "en" },
    ],
  });
  assert.equal(refined.text, "今日は a busy day");
  assert.equal(refined.isFinal, false);

  const endpoint = transcript.apply({
    tokens: [
      { text: " busy day", is_final: true, confidence: 0.95, language: "en" },
      { text: "でした。", is_final: true, confidence: 0.97, language: "ja" },
      { text: "<end>", is_final: true },
    ],
  });
  assert.equal(endpoint.text, "今日は a busy dayでした。");
  assert.equal(endpoint.isFinal, true);
  assert.equal(endpoint.endpoint, true);
  assert.deepEqual(endpoint.languages, ["ja", "en"]);
});

test("finished messages preserve the complete transcript", () => {
  const transcript = new SonioxTranscriptAccumulator();
  transcript.apply({
    tokens: [{ text: "Please speak English.", is_final: true }],
  });

  const finished = transcript.apply({ tokens: [], finished: true });
  assert.equal(finished.text, "Please speak English.");
  assert.equal(finished.isFinal, true);
  assert.equal(finished.finished, true);
});

test("PCM conversion clips samples and writes signed 16-bit little-endian", () => {
  const bytes = float32ToPCM16(Float32Array.from([-2, -1, -0.5, 0, 0.5, 1, 2]));
  const view = new DataView(bytes);
  assert.deepEqual(
    Array.from({ length: 7 }, (_, index) => view.getInt16(index * 2, true)),
    [-32768, -32768, -16384, 0, 16384, 32767, 32767],
  );
});

test("microphone energy keeps silence quiet and normal speech above the endpoint floor", () => {
  assert.equal(normalizedAudioEnergy(new Float32Array(160)), 0);
  assert.ok(
    normalizedAudioEnergy(Float32Array.from({ length: 160 }, () => 0.02)) >
      0.06,
  );
  assert.equal(
    normalizedAudioEnergy(Float32Array.from({ length: 160 }, () => 1)),
    1,
  );
});
