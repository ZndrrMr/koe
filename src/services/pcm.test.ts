import assert from "node:assert/strict";
import test from "node:test";
import { pcm16EnergyFromBase64, pcmBase64ToWavBase64 } from "./pcm";

test("pcmBase64ToWavBase64 wraps streamed PCM with a valid mono WAV header", () => {
  const pcm = Buffer.from([0, 0, 255, 127, 0, 128]);
  const wav = Buffer.from(
    pcmBase64ToWavBase64(pcm.toString("base64"), 48_000),
    "base64",
  );

  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 48_000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
});

test("pcm16EnergyFromBase64 follows actual PCM amplitude", () => {
  const encode = (samples: number[]) => {
    const pcm = Buffer.alloc(samples.length * 2);
    samples.forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
    return pcm.toString("base64");
  };

  const silence = pcm16EnergyFromBase64(encode([0, 0, 0, 0]));
  const conversational = pcm16EnergyFromBase64(
    encode([0, 4_000, -4_000, 8_000, -8_000, 0]),
  );
  const loud = pcm16EnergyFromBase64(
    encode([0, 20_000, -20_000, 28_000, -28_000, 0]),
  );

  assert.equal(silence, 0);
  assert.ok(conversational > silence);
  assert.ok(loud > conversational);
  assert.ok(loud <= 1);
});
