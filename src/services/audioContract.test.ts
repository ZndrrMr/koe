import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  AudioContractError,
  validateInworldRouterChunk,
  validateInworldStandaloneMP3,
} from "./audioContract";
import {
  INWORLD_ROUTER_AUDIO_CONTRACT,
  INWORLD_STANDALONE_AUDIO_CONTRACT,
} from "../../shared/inworld";
import audioFixture from "../../shared/fixtures/inworldAudioContract.json";

const pcmSpeechExcerpt = Buffer.from(
  audioFixture.routerStream.audioBase64,
  "base64",
);

test("validates representative non-silent Router PCM frames", () => {
  const observation = validateInworldRouterChunk(
    pcmSpeechExcerpt.toString("base64"),
    INWORLD_ROUTER_AUDIO_CONTRACT,
  );
  assert.equal(observation.observedEncoding, "pcm_s16le");
  assert.equal(observation.sampleRate, 48_000);
  assert.equal(observation.channels, 1);
  assert.equal(observation.byteCount, pcmSpeechExcerpt.length);
  assert.equal(observation.frameCount, pcmSpeechExcerpt.length / 2);
  assert.equal(
    createHash("sha256").update(pcmSpeechExcerpt).digest("hex"),
    audioFixture.routerStream.sha256,
  );
});

test("rejects Router sample-rate and channel disagreement", () => {
  assert.throws(
    () =>
      validateInworldRouterChunk(pcmSpeechExcerpt.toString("base64"), {
        ...INWORLD_ROUTER_AUDIO_CONTRACT,
        sampleRate: 24_000,
      }),
    (error: unknown) =>
      error instanceof AudioContractError &&
      error.kind === "sample-rate-mismatch",
  );
  assert.throws(
    () =>
      validateInworldRouterChunk(pcmSpeechExcerpt.toString("base64"), {
        ...INWORLD_ROUTER_AUDIO_CONTRACT,
        channels: 2,
      }),
    (error: unknown) =>
      error instanceof AudioContractError && error.kind === "channel-mismatch",
  );
});

test("rejects empty, invalid, misaligned, and containerized Router audio", () => {
  for (const [audio, kind] of [
    ["", "empty-audio"],
    ["%%%not-base64%%%", "invalid-base64"],
    [Buffer.from([1, 2, 3]).toString("base64"), "invalid-frame-alignment"],
    [Buffer.from("RIFF....WAVEfmt ").toString("base64"), "encoding-mismatch"],
  ] as const) {
    assert.throws(
      () => validateInworldRouterChunk(audio, INWORLD_ROUTER_AUDIO_CONTRACT),
      (error: unknown) =>
        error instanceof AudioContractError && error.kind === kind,
    );
  }
});

test("standalone audio requires MP3 bytes and its declared 24 kHz contract", () => {
  const mp3Frame = Buffer.from(audioFixture.standalone.audioBase64, "base64");
  assert.equal(
    validateInworldStandaloneMP3(mp3Frame, "audio/mpeg").observedEncoding,
    "mp3",
  );
  assert.equal(
    createHash("sha256").update(mp3Frame).digest("hex"),
    audioFixture.standalone.sha256,
  );
  assert.throws(
    () => validateInworldStandaloneMP3(new Uint8Array(), "audio/mpeg"),
    (error: unknown) =>
      error instanceof AudioContractError && error.kind === "empty-audio",
  );
  assert.throws(
    () =>
      validateInworldStandaloneMP3(mp3Frame, "audio/wav", {
        ...INWORLD_STANDALONE_AUDIO_CONTRACT,
      }),
    (error: unknown) =>
      error instanceof AudioContractError &&
      error.kind === "content-type-mismatch",
  );
  assert.throws(
    () =>
      validateInworldStandaloneMP3(mp3Frame, "audio/mpeg", {
        ...INWORLD_STANDALONE_AUDIO_CONTRACT,
        sampleRate: 48_000,
      }),
    (error: unknown) =>
      error instanceof AudioContractError &&
      error.kind === "sample-rate-mismatch",
  );

  const frameOffset = mp3Frame.findIndex(
    (byte, index) => byte === 0xff && (mp3Frame[index + 1] ?? 0) >>> 5 === 0x07,
  );
  assert.notEqual(frameOffset, -1);
  const wrongObservedRate = Uint8Array.from(mp3Frame);
  wrongObservedRate[frameOffset + 2] &= 0xf3;
  assert.throws(
    () => validateInworldStandaloneMP3(wrongObservedRate, "audio/mpeg"),
    (error: unknown) =>
      error instanceof AudioContractError &&
      error.kind === "sample-rate-mismatch",
  );

  const stereo = Uint8Array.from(mp3Frame);
  stereo[frameOffset + 3] &= 0x3f;
  assert.throws(
    () => validateInworldStandaloneMP3(stereo, "audio/mpeg"),
    (error: unknown) =>
      error instanceof AudioContractError && error.kind === "channel-mismatch",
  );
});
