import assert from "node:assert/strict";
import test from "node:test";
import {
  pcmBase64ChunksToWavBase64,
  pcmBase64ToWavBase64,
} from "./pcm";

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

test("pcmBase64ChunksToWavBase64 preserves every streamed chunk in order", () => {
  const first = Buffer.from([0, 0, 1, 0]);
  const second = Buffer.from([2, 0, 3, 0]);
  const wav = Buffer.from(
    pcmBase64ChunksToWavBase64(
      [first.toString("base64"), second.toString("base64")],
      24_000,
    ),
    "base64",
  );

  assert.equal(wav.readUInt32LE(24), 24_000);
  assert.equal(wav.readUInt32LE(40), first.length + second.length);
  assert.deepEqual(wav.subarray(44), Buffer.concat([first, second]));
});
