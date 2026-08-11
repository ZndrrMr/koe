import assert from "node:assert/strict";
import test from "node:test";
import { app } from "./index";

test("llm chat passes streamed text and audio SSE through without buffering", async () => {
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
    const counters = new Map<string, string>();
    const response = await app.request(
      "/llm/chat",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          system: "Be concise.",
          messages: [{ role: "user", content: "こんにちは" }],
          voice: "ja-female-1",
          stream: true,
        }),
      },
      {
        KOE_KV: {
          get: async (key: string) => counters.get(key) ?? null,
          put: async (key: string, value: string) => {
            counters.set(key, value);
          },
        },
        INWORLD_API_KEY: "test-key",
        SONIOX_API_KEY: "test-key",
        GEMINI_API_KEY: "test-key",
        RATE_LIMIT_TTS: "500",
        RATE_LIMIT_LLM: "200",
        RATE_LIMIT_STT_SECONDS: "360000",
        INWORLD_MODEL: "inworld-tts-1.5-max",
        GEMINI_TUTOR_MODEL: "gemini-test",
        GEMINI_FLASH_MODEL: "gemini-test",
      } as never,
    );

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("Content-Type") ?? "",
      /text\/event-stream/,
    );
    assert.equal(await response.text(), upstreamSSE);
    assert.equal(upstreamBody?.stream, true);
    assert.deepEqual(upstreamBody?.audio, {
      voice: "Asuka",
      model: "inworld-tts-1.5-max",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("feedback prompt applies the optional coaching detail", async () => {
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
    const counters = new Map<string, string>();
    const response = await app.request(
      "/llm/flash",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "feedback",
          correctionStyle: "detailed",
          userTurn: "こんにちは",
          tutorReply: "こんにちは。今日はどうですか？",
        }),
      },
      {
        KOE_KV: {
          get: async (key: string) => counters.get(key) ?? null,
          put: async (key: string, value: string) => {
            counters.set(key, value);
          },
        },
        INWORLD_API_KEY: "test-key",
        SONIOX_API_KEY: "test-key",
        GEMINI_API_KEY: "test-key",
        RATE_LIMIT_TTS: "500",
        RATE_LIMIT_LLM: "200",
        RATE_LIMIT_STT_SECONDS: "360000",
        INWORLD_MODEL: "inworld-tts-1.5-max",
        GEMINI_TUTOR_MODEL: "gemini-test",
        GEMINI_FLASH_MODEL: "gemini-test",
      } as never,
    );

    assert.equal(response.status, 200);
    const prompt = upstreamBody?.contents?.[0]?.parts?.[0]?.text ?? "";
    assert.match(prompt, /COACHING DETAIL: detailed/);
    assert.match(prompt, /up to three compact corrections/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
