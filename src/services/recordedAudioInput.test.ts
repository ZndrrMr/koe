import assert from "node:assert/strict";
import test from "node:test";

import audioFixture from "../../shared/fixtures/inworldAudioContract.json";
import {
  RECORDED_AUDIO_MAX_BYTES,
  RecordedAudioContractError,
  validateRecordedAudioEnvelope,
  type RecordedAudioFormat,
  type RecordedAudioMetadata,
} from "../../shared/recordedAudio";
import {
  RecordedAudioInputError,
  transcribeRecordedAudio,
  type RecordedAudioFile,
  type RecordedAudioInputRuntime,
} from "./recordedAudioInput";

const CANONICAL_TEXT = "明日は京都へ行きます。";

function recordedFile(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
): RecordedAudioFile {
  const blob = new Blob([Uint8Array.from(bytes).buffer as ArrayBuffer], {
    type: mimeType,
  });
  Object.defineProperties(blob, {
    uri: { value: `file:///fixtures/${filename}` },
    name: { value: filename },
    exists: { value: true },
  });
  return blob as RecordedAudioFile;
}

function wavFixture(
  sampleRate = 16_000,
  channels = 1,
  durationMs = 200,
): Uint8Array {
  const sampleCount = Math.round((sampleRate * durationMs) / 1_000);
  const dataBytes = sampleCount * channels * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(bytes, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}

function m4aFixture(): Uint8Array {
  const bytes = new Uint8Array(48);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 24, false);
  writeAscii(bytes, 4, "ftypM4A ");
  writeAscii(bytes, 16, "M4A isom");
  view.setUint32(24, 24, false);
  writeAscii(bytes, 28, "mdat");
  return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

test("MP3, M4A, and WAV keep truthful metadata through recorded STT", async () => {
  const cases: Array<{
    format: RecordedAudioFormat;
    mimeType: string;
    bytes: Uint8Array;
    sampleRate: number;
    channels: number;
    durationMs: number;
  }> = [
    {
      format: "mp3",
      mimeType: "audio/mpeg",
      bytes: Buffer.from(audioFixture.standalone.audioBase64, "base64"),
      sampleRate: 24_000,
      channels: 1,
      durationMs: 300,
    },
    {
      format: "m4a",
      mimeType: "audio/mp4",
      bytes: m4aFixture(),
      sampleRate: 44_100,
      channels: 2,
      durationMs: 200,
    },
    {
      format: "wav",
      mimeType: "audio/wav",
      bytes: wavFixture(),
      sampleRate: 16_000,
      channels: 1,
      durationMs: 200,
    },
  ];

  for (const input of cases) {
    const file = recordedFile(
      input.bytes,
      `canonical.${input.format}`,
      input.mimeType,
    );
    let uploaded: RecordedAudioMetadata | undefined;
    const runtime: RecordedAudioInputRuntime = {
      materialize: async () => file,
      decode: async () => ({
        numberOfChannels: input.channels,
        sampleRate: input.sampleRate,
        length: Math.round((input.sampleRate * input.durationMs) / 1_000),
      }),
      transcribe: async (encodedBytes, metadata) => {
        assert.deepEqual(encodedBytes, Uint8Array.from(input.bytes));
        uploaded = metadata;
        return { text: CANONICAL_TEXT, audio: metadata };
      },
    };

    const result = await transcribeRecordedAudio(
      { uri: file.uri, filename: file.name, mimeType: file.type },
      { sessionId: "session", turnId: `turn-${input.format}` },
      runtime,
    );

    assert.equal(result.text, CANONICAL_TEXT);
    assert.equal(result.audioUri, file.uri);
    assert.equal(result.metadata.format, input.format);
    assert.equal(result.metadata.filename, file.name);
    assert.equal(result.metadata.mimeType, input.mimeType);
    assert.equal(result.metadata.sampleRate, input.sampleRate);
    assert.equal(result.metadata.channels, input.channels);
    assert.equal(Math.round(result.metadata.durationMs), input.durationMs);
    assert.deepEqual(uploaded, result.metadata);
  }
});

test("invalid, empty, truncated, huge, long, unsupported, and mismatched files fail explicitly", () => {
  const validMetadata = {
    filename: "input.wav",
    mimeType: "audio/wav",
    sampleRate: 16_000,
    channels: 1,
    durationMs: 200,
  };
  const cases: Array<{
    expected: RecordedAudioContractError["kind"];
    run: () => unknown;
  }> = [
    {
      expected: "empty-audio",
      run: () =>
        validateRecordedAudioEnvelope({
          ...validMetadata,
          bytes: new Uint8Array(),
        }),
    },
    {
      expected: "invalid-audio",
      run: () =>
        validateRecordedAudioEnvelope({
          ...validMetadata,
          bytes: new TextEncoder().encode("not audio"),
        }),
    },
    {
      expected: "truncated-audio",
      run: () =>
        validateRecordedAudioEnvelope({
          ...validMetadata,
          bytes: new TextEncoder().encode("RIFF"),
        }),
    },
    {
      expected: "truncated-audio",
      run: () =>
        validateRecordedAudioEnvelope({
          ...validMetadata,
          filename: "input.m4a",
          mimeType: "audio/mp4",
          bytes: m4aFixture().subarray(0, 24),
        }),
    },
    {
      expected: "truncated-audio",
      run: () =>
        validateRecordedAudioEnvelope({
          ...validMetadata,
          filename: "input.mp3",
          mimeType: "audio/mpeg",
          bytes: new TextEncoder().encode(
            "ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000",
          ),
        }),
    },
    {
      expected: "audio-too-large",
      run: () =>
        validateRecordedAudioEnvelope({
          ...validMetadata,
          bytes: wavFixture(),
          byteCount: RECORDED_AUDIO_MAX_BYTES + 1,
        }),
    },
    {
      expected: "audio-too-long",
      run: () =>
        validateRecordedAudioEnvelope({
          ...validMetadata,
          durationMs: 5 * 60 * 1_000 + 1,
          bytes: wavFixture(),
        }),
    },
    {
      expected: "unsupported-audio",
      run: () =>
        validateRecordedAudioEnvelope({
          ...validMetadata,
          filename: "input.flac",
          mimeType: "audio/flac",
          bytes: wavFixture(),
        }),
    },
    {
      expected: "audio-metadata-mismatch",
      run: () =>
        validateRecordedAudioEnvelope({
          ...validMetadata,
          mimeType: "audio/mpeg",
          bytes: wavFixture(),
        }),
    },
  ];

  for (const input of cases) {
    assert.throws(
      input.run,
      (error) =>
        error instanceof RecordedAudioContractError &&
        error.kind === input.expected,
      input.expected,
    );
  }
});

test("a Worker metadata mutation is a recoverable explicit failure", async () => {
  const bytes = wavFixture();
  const file = recordedFile(bytes, "canonical.wav", "audio/wav");
  const runtime: RecordedAudioInputRuntime = {
    materialize: async () => file,
    decode: async () => ({
      numberOfChannels: 1,
      sampleRate: 16_000,
      length: 3_200,
    }),
    transcribe: async (_file, metadata) => ({
      text: CANONICAL_TEXT,
      audio: { ...metadata, filename: "audio.m4a" },
    }),
  };

  await assert.rejects(
    () =>
      transcribeRecordedAudio(
        { uri: file.uri, filename: file.name, mimeType: file.type },
        {},
        runtime,
      ),
    (error) =>
      error instanceof RecordedAudioInputError &&
      error.kind === "audio-metadata-mismatch",
  );
});
