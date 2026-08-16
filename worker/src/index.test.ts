import assert from "node:assert/strict";
import test from "node:test";
import { app } from "./index";
import {
  INWORLD_ROUTER_AUDIO_CONTRACT,
  INWORLD_STANDALONE_AUDIO_CONTRACT,
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
    INWORLD_MODEL: "inworld-tts-1.5-max",
    INWORLD_API_BASE_URL: "https://provider.test",
    GEMINI_API_BASE_URL: "https://gemini.test",
    GEMINI_TUTOR_MODEL: "gemini-test",
    GEMINI_FLASH_MODEL: "gemini-test",
  } as never;
}

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
    assert.deepEqual(upstreamBody?.audio, {
      voice: KOE_V1_VOICE_ID,
      model: "inworld-tts-1.5-max",
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

test("stream inspection rejects empty audio and a missing DONE event", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const upstreamSSE of [
      'data: {"choices":[{"delta":{"audio":{"data":"","transcript":""}}}]}\n\ndata: [DONE]\n\n',
      'data: {"choices":[{"delta":{"audio":{"data":"AAE=","transcript":""}}}]}\n\n',
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
