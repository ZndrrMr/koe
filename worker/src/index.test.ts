import assert from "node:assert/strict";
import test from "node:test";
import { app } from "./index";
import {
  INWORLD_ROUTER_AUDIO_CONTRACT,
  INWORLD_STANDALONE_AUDIO_CONTRACT,
  KOE_V1_MAX_REPLY_TOKENS,
  KOE_V1_ROUTER_MODEL,
  KOE_V1_TTS_MODEL,
  KOE_V1_VOICE_ID,
} from "../../shared/inworld";
import audioFixture from "../../shared/fixtures/inworldAudioContract.json";

function testEnv() {
  const counters = new Map<string, string>();
  return {
    KOE_KV: {
      get: async (key: string) => counters.get(key) ?? null,
      put: async (key: string, value: string | ArrayBuffer | Uint8Array) => {
        if (typeof value === "string") counters.set(key, value);
      },
    },
    INWORLD_API_KEY: "test-key",
    SONIOX_API_KEY: "test-key",
    GEMINI_API_KEY: "test-key",
    RATE_LIMIT_TTS: "500",
    RATE_LIMIT_LLM: "200",
    RATE_LIMIT_STT_SECONDS: "360000",
    INWORLD_MODEL: KOE_V1_TTS_MODEL,
    INWORLD_API_BASE_URL: "https://provider.test",
    SONIOX_API_BASE_URL: "https://soniox.test",
    GEMINI_API_BASE_URL: "https://gemini.test",
    GEMINI_TUTOR_MODEL: "gemini-test",
    GEMINI_FLASH_MODEL: "gemini-test",
  } as never;
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

function recordedAudioRequest(input: {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  sampleRate: number;
  channels: number;
  durationMs: number;
  contentLength?: number;
}): { method: string; headers: Record<string, string>; body: ArrayBuffer } {
  return {
    method: "POST",
    headers: {
      "Content-Type": input.mimeType,
      "Content-Length": String(input.contentLength ?? input.bytes.byteLength),
      "X-Koe-Audio-Filename": encodeURIComponent(input.filename),
      "X-Koe-Audio-Sample-Rate": String(input.sampleRate),
      "X-Koe-Audio-Channels": String(input.channels),
      "X-Koe-Audio-Duration-Ms": String(input.durationMs),
      "X-Koe-Session-Id": "session-recorded",
      "X-Koe-Turn-Id": `turn-${input.filename}`,
    },
    body: input.bytes.buffer.slice(
      input.bytes.byteOffset,
      input.bytes.byteOffset + input.bytes.byteLength,
    ) as ArrayBuffer,
  };
}

test("recorded MP3, M4A, and WAV use one truthful Soniox file-transcription path", async () => {
  const originalFetch = globalThis.fetch;
  const uploads: Array<{ filename: string; type: string; bytes: Uint8Array }> =
    [];
  const transcriptionBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://soniox.test/v1/files" && init?.method === "POST") {
      const file = (init.body as FormData).get("file") as File;
      uploads.push({
        filename: file.name,
        type: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      return Response.json({ id: `file-${uploads.length}` }, { status: 201 });
    }
    if (
      url === "https://soniox.test/v1/transcriptions" &&
      init?.method === "POST"
    ) {
      transcriptionBodies.push(JSON.parse(String(init.body)));
      return Response.json({ id: `tx-${transcriptionBodies.length}` });
    }
    if (url.endsWith("/transcript")) {
      return Response.json({
        tokens: [{ text: "明日は" }, { text: "京都へ行きます。" }],
      });
    }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (url.includes("/v1/transcriptions/")) {
      return Response.json({ status: "completed" });
    }
    throw new Error(`Unexpected provider request: ${url}`);
  };

  const cases = [
    {
      format: "mp3",
      filename: "canonical.mp3",
      mimeType: "audio/mpeg",
      bytes: new Uint8Array(
        Buffer.from(audioFixture.standalone.audioBase64, "base64"),
      ),
      sampleRate: 24_000,
      channels: 1,
      durationMs: 300,
    },
    {
      format: "m4a",
      filename: "canonical.m4a",
      mimeType: "audio/mp4",
      bytes: m4aFixture(),
      sampleRate: 44_100,
      channels: 2,
      durationMs: 200,
    },
    {
      format: "wav",
      filename: "canonical.wav",
      mimeType: "audio/wav",
      bytes: wavFixture(),
      sampleRate: 16_000,
      channels: 1,
      durationMs: 200,
    },
  ] as const;

  try {
    for (const input of cases) {
      const response = await app.request(
        "/stt/transcribe?lang=ja,en",
        recordedAudioRequest(input),
        testEnv(),
      );
      assert.equal(response.status, 200);
      const payload = (await response.json()) as {
        text: string;
        audio: Record<string, unknown>;
      };
      assert.equal(payload.text, "明日は京都へ行きます。");
      assert.deepEqual(payload.audio, {
        filename: input.filename,
        mimeType: input.mimeType,
        format: input.format,
        byteCount: input.bytes.byteLength,
        sampleRate: input.sampleRate,
        channels: input.channels,
        durationMs: input.durationMs,
      });
    }

    assert.deepEqual(
      uploads.map(({ filename, type }) => ({ filename, type })),
      cases.map(({ filename, mimeType }) => ({
        filename,
        type: mimeType,
      })),
    );
    cases.forEach((input, index) =>
      assert.deepEqual(uploads[index]!.bytes, input.bytes),
    );
    assert.ok(
      transcriptionBodies.every((body) => body.model === "stt-async-v5"),
    );
    assert.deepEqual(
      transcriptionBodies.map((body) => body.language_hints),
      cases.map(() => ["ja", "en"]),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("recorded STT rejects invalid inputs explicitly without contacting Soniox", async () => {
  const originalFetch = globalThis.fetch;
  let providerRequests = 0;
  globalThis.fetch = async () => {
    providerRequests += 1;
    throw new Error("Soniox must not receive invalid audio");
  };
  const base = {
    bytes: wavFixture(),
    filename: "input.wav",
    mimeType: "audio/wav",
    sampleRate: 16_000,
    channels: 1,
    durationMs: 200,
  };
  const cases = [
    {
      expectedStatus: 400,
      expectedCode: "empty-audio",
      input: { ...base, bytes: new Uint8Array() },
    },
    {
      expectedStatus: 400,
      expectedCode: "invalid-audio",
      input: { ...base, bytes: new TextEncoder().encode("not audio") },
    },
    {
      expectedStatus: 400,
      expectedCode: "truncated-audio",
      input: { ...base, bytes: new TextEncoder().encode("RIFF") },
    },
    {
      expectedStatus: 413,
      expectedCode: "audio-too-large",
      input: { ...base, contentLength: 20 * 1024 * 1024 + 1 },
    },
    {
      expectedStatus: 400,
      expectedCode: "audio-too-long",
      input: { ...base, durationMs: 5 * 60 * 1_000 + 1 },
    },
    {
      expectedStatus: 415,
      expectedCode: "unsupported-audio",
      input: { ...base, filename: "input.flac", mimeType: "audio/flac" },
    },
    {
      expectedStatus: 422,
      expectedCode: "audio-metadata-mismatch",
      input: { ...base, sampleRate: 48_000 },
    },
  ];

  try {
    for (const input of cases) {
      const response = await app.request(
        "/stt/transcribe",
        recordedAudioRequest(input.input),
        testEnv(),
      );
      assert.equal(response.status, input.expectedStatus);
      const payload = (await response.json()) as {
        error: { code: string; recoverable: boolean };
      };
      assert.equal(payload.error.code, input.expectedCode);
      assert.equal(payload.error.recoverable, true);
    }
    assert.equal(providerRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("llm chat passes SSE through and pins the one V1 voice", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamBody: Record<string, unknown> | undefined;
  const upstreamSSE =
    'data: {"choices":[{"delta":{"audio":{"data":"AAE=","transcript":"こんにちは"}}}]}\n\n' +
    "data: [DONE]\n\n";
  globalThis.fetch = async (_input, init) => {
    upstreamBody = JSON.parse(String(init?.body));
    return new Response(upstreamSSE, {
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  try {
    const response = await app.request(
      "/llm/chat",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "X-Koe-Session-Id": "session-test",
          "X-Koe-Turn-Id": "turn-test",
          "X-Koe-Response-Run-Id": "run-test",
        },
        body: JSON.stringify({
          system: "Be concise.",
          messages: [{ role: "user", content: "こんにちは" }],
          // Obsolete saved request fields must not alter the provider voice.
          voice: "old-saved-voice",
          stream: true,
        }),
      },
      testEnv(),
    );

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("Content-Type") ?? "",
      /text\/event-stream/,
    );
    assert.equal(await response.text(), upstreamSSE);
    assert.equal(
      response.headers.get("X-Koe-Audio-Encoding"),
      INWORLD_ROUTER_AUDIO_CONTRACT.encoding,
    );
    assert.equal(
      response.headers.get("X-Koe-Audio-Sample-Rate"),
      String(INWORLD_ROUTER_AUDIO_CONTRACT.sampleRate),
    );
    assert.equal(
      response.headers.get("X-Koe-Audio-Channels"),
      String(INWORLD_ROUTER_AUDIO_CONTRACT.channels),
    );
    assert.equal(response.headers.get("X-Koe-Voice-Id"), KOE_V1_VOICE_ID);
    assert.equal(response.headers.get("X-Koe-Response-Run-Id"), "run-test");
    assert.equal(upstreamBody?.stream, true);
    assert.equal(upstreamBody?.model, KOE_V1_ROUTER_MODEL);
    assert.equal(upstreamBody?.max_tokens, KOE_V1_MAX_REPLY_TOKENS);
    assert.deepEqual(upstreamBody?.extra_body, { sort: ["latency"] });
    assert.deepEqual(upstreamBody?.audio, {
      voice: KOE_V1_VOICE_ID,
      model: KOE_V1_TTS_MODEL,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("feedback ignores obsolete preferences and applies one essential contract", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamBody:
    | { contents?: Array<{ parts?: Array<{ text?: string }> }> }
    | undefined;
  globalThis.fetch = async (_input, init) => {
    upstreamBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    translations: { user: "Hello", tutor: "Hello" },
                    corrections: {
                      particles: [],
                      register: { consistent: true },
                      other: [],
                    },
                  }),
                },
              ],
            },
          },
        ],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const response = await app.request(
      "/llm/flash",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "feedback",
          responseLevel: "old-saved-level",
          correctionStyle: "detailed",
          userTurn: "こんにちは",
          tutorReply: "こんにちは。今日はどうですか？",
        }),
      },
      testEnv(),
    );

    assert.equal(response.status, 200);
    const prompt = upstreamBody?.contents?.[0]?.parts?.[0]?.text ?? "";
    assert.match(prompt, /ESSENTIAL FEEDBACK CONTRACT/);
    assert.match(prompt, /at most one compact correction/);
    assert.doesNotMatch(prompt, /old-saved-level|detailed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("live quality evaluation is versioned, deterministic, and server-prompted", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamBody:
    | {
        contents?: Array<{ parts?: Array<{ text?: string }> }>;
        generationConfig?: { temperature?: number };
      }
    | undefined;
  globalThis.fetch = async (_input, init) => {
    upstreamBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    scores: {
                      responseRelevance: 5,
                      naturalness: 5,
                      languageChoice: 5,
                      conversationalContinuity: 5,
                      tutoringJudgment: 5,
                      transcriptGrounding: 5,
                      contextStability: 5,
                    },
                    criticalViolations: [],
                    evidence: "The reply acknowledges the stated feeling.",
                    pass: true,
                  }),
                },
              ],
            },
          },
        ],
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "quality-grade-request",
        },
      },
    );
  };

  try {
    const response = await app.request(
      "/llm/quality",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Koe-Session-Id": "quality-session",
          "X-Koe-Turn-Id": "quality-turn",
        },
        body: JSON.stringify({
          scenarioId: "neutral",
          scenarioDescription: "ordinary conversation",
          coverage: ["neutral-conversation"],
          history: [],
          transcript: "今日は疲れました。",
          replyText: "そうなんですね。今日は忙しかったですか？",
          feedback: {
            corrections: {
              particles: [],
              register: { consistent: true },
              other: [],
            },
          },
          expectedLanguage: "ja",
          teachingRequested: false,
          correctionPolicy: "none",
          transcriptUncertain: false,
        }),
      },
      testEnv(),
    );

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      evaluator: {
        id: string;
        model: string;
        promptVersion: string;
        promptSha256: string;
        providerRequestId: string;
      };
      verdict: { pass: boolean };
    };
    assert.equal(payload.evaluator.id, "koe-conversation-quality");
    assert.equal(payload.evaluator.model, "gemini-test");
    assert.match(payload.evaluator.promptVersion, /2026-08-17\.v1/);
    assert.match(payload.evaluator.promptSha256, /^[a-f0-9]{64}$/);
    assert.equal(payload.evaluator.providerRequestId, "quality-grade-request");
    assert.equal(payload.verdict.pass, true);
    const prompt = upstreamBody?.contents?.[0]?.parts?.[0]?.text ?? "";
    assert.match(prompt, /responseRelevance/);
    assert.match(prompt, /Forced retries, unsolicited drills/);
    assert.match(prompt, /今日は疲れました/);
    assert.equal(upstreamBody?.generationConfig?.temperature, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quality evaluation rejects malformed input before provider spend", async () => {
  const originalFetch = globalThis.fetch;
  let providerRequests = 0;
  globalThis.fetch = async () => {
    providerRequests += 1;
    throw new Error("malformed quality input must not reach Gemini");
  };
  try {
    const response = await app.request(
      "/llm/quality",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: "missing-fields" }),
      },
      testEnv(),
    );
    assert.equal(response.status, 400);
    assert.equal(providerRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stream inspection rejects malformed, truncated, empty, and invalidly encoded SSE", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const upstreamSSE of [
      'data: {"choices":[{"delta":{"audio":{"data":"","transcript":""}}}]}\n\ndata: [DONE]\n\n',
      'data: {"choices":[{"delta":{"audio":{"data":"AAE=","transcript":""}}}]}\n\n',
      'data: {"choices":[{"delta":{"audio":{"data":"not-base64","transcript":""}}}]}\n\ndata: [DONE]\n\n',
      'data: {"choices":[{"delta":{"audio":{"data":"UklGRi4uLi5XQVZF","transcript":""}}}]}\n\ndata: [DONE]\n\n',
      'data: {"choices":[{"delta":BROKEN}]}\n\ndata: [DONE]\n\n',
    ]) {
      globalThis.fetch = async () =>
        new Response(upstreamSSE, {
          headers: { "Content-Type": "text/event-stream" },
        });
      const response = await app.request(
        "/llm/chat",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system: "Be concise.",
            messages: [{ role: "user", content: "こんにちは" }],
            stream: true,
          }),
        },
        testEnv(),
      );
      assert.equal(response.status, 200);
      await assert.rejects(() => response.text());
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stream inspection accepts provider SSE fragmented at every byte boundary", async () => {
  const originalFetch = globalThis.fetch;
  const upstreamSSE =
    'data: {"choices":[{"delta":{"content":"こんにちは"}}]}\r\n\r\n' +
    'data: {"choices":[{"delta":{"audio":{"data":"AAE=","transcript":"。"}}}]}\r\n\r\n' +
    "data: [DONE]\r\n\r\n";
  const bytes = new TextEncoder().encode(upstreamSSE);
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
          controller.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );

  try {
    const response = await app.request(
      "/llm/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: "Be concise.",
          messages: [{ role: "user", content: "こんにちは" }],
          stream: true,
        }),
      },
      testEnv(),
    );
    assert.equal(await response.text(), upstreamSSE);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("standalone TTS validates representative MP3 speech and declares its contract", async () => {
  const originalFetch = globalThis.fetch;
  const mp3Frame = Buffer.from(audioFixture.standalone.audioBase64, "base64");
  let providerBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(String(init?.body));
    return Response.json(
      {
        audioContent: Buffer.from(mp3Frame).toString("base64"),
        durationMs: 120,
      },
      {
        headers: { "X-Request-Id": "provider-tts-test" },
      },
    );
  };

  try {
    const response = await app.request(
      "/tts",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Koe-Session-Id": "session-test",
          "X-Koe-Turn-Id": "turn-test",
          "X-Koe-Response-Run-Id": "run-test",
        },
        body: JSON.stringify({ text: "こんにちは" }),
      },
      testEnv(),
    );

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("Content-Type"),
      INWORLD_STANDALONE_AUDIO_CONTRACT.contentType,
    );
    assert.equal(
      response.headers.get("X-Koe-Audio-Encoding"),
      INWORLD_STANDALONE_AUDIO_CONTRACT.encoding,
    );
    assert.equal(
      response.headers.get("X-Koe-Audio-Sample-Rate"),
      String(INWORLD_STANDALONE_AUDIO_CONTRACT.sampleRate),
    );
    assert.equal(providerBody?.voiceId, KOE_V1_VOICE_ID);
    assert.equal(providerBody?.modelId, KOE_V1_TTS_MODEL);
    assert.deepEqual(providerBody?.audioConfig, {
      audioEncoding: "MP3",
      sampleRateHertz: INWORLD_STANDALONE_AUDIO_CONTRACT.sampleRate,
    });
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp3Frame);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("standalone TTS rejects observed encoding, sample-rate, and channel mismatches", async () => {
  const originalFetch = globalThis.fetch;
  const mp3 = Buffer.from(audioFixture.standalone.audioBase64, "base64");
  const frameOffset = mp3.findIndex(
    (byte: number, index: number) =>
      byte === 0xff && (mp3[index + 1] ?? 0) >>> 5 === 0x07,
  );
  assert.notEqual(frameOffset, -1);
  const wrongRate = Buffer.from(mp3);
  wrongRate[frameOffset + 2] &= 0xf3;
  const stereo = Buffer.from(mp3);
  stereo[frameOffset + 3] &= 0x3f;
  try {
    for (const bytes of [Buffer.from("RIFF....WAVEfmt "), wrongRate, stereo]) {
      globalThis.fetch = async () =>
        Response.json({ audioContent: bytes.toString("base64") });
      const response = await app.request(
        "/tts",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "こんにちは" }),
        },
        testEnv(),
      );
      assert.equal(response.status, 502);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
