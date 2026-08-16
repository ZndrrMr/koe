/**
 * Koe edge proxy (Cloudflare Worker).
 *
 * Routes:
 *   POST /tts        → Inworld TTS, streams audio (mp3) back
 *   GET  /stt/token  → returns a short-lived Soniox streaming URL + temp key
 *   POST /llm/chat   → streams Inworld Router text + PCM speech over SSE
 *   POST /llm/flash  → proxies Gemini 3.1 Flash-Lite for language coaching/examples
 *   POST /furigana   → Gemini-powered furigana annotation with KV caching
 *
 * Secrets (wrangler secret put):
 *   INWORLD_API_KEY, SONIOX_API_KEY, GEMINI_API_KEY
 */

import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import {
  INWORLD_STANDALONE_AUDIO_CONTRACT,
  KOE_V1_VOICE_ID,
} from "../../shared/inworld";
import {
  inspectRouterStream,
  routerResponseHeaders,
  standaloneResponseHeaders,
  validateStandaloneAudio,
  ProviderContractError,
} from "./providerContract";
import { providerRequestId, workerEvent, workerTrace } from "./telemetry";

type SecretEnv = {
  INWORLD_API_KEY: string;
  SONIOX_API_KEY: string;
  GEMINI_API_KEY: string;
};

type KoeEnv = Env & SecretEnv;

const app = new Hono<{ Bindings: KoeEnv }>();
export { app };

type AppContext = Context<{ Bindings: KoeEnv }>;

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: [
      "Content-Type",
      "Accept",
      "X-Device-Id",
      "X-Koe-Session-Id",
      "X-Koe-Turn-Id",
      "X-Koe-Response-Run-Id",
    ],
    exposeHeaders: [
      "X-Koe-Audio-Encoding",
      "X-Koe-Audio-Sample-Rate",
      "X-Koe-Audio-Channels",
      "X-Koe-Voice-Id",
      "X-Koe-Provider-Request-Id",
      "X-Koe-Response-Run-Id",
    ],
  }),
);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function deviceId(c: AppContext): string {
  return c.req.header("X-Device-Id") ?? "anon";
}

async function bumpCounter(
  kv: KVNamespace,
  key: string,
  amount: number,
  limit: number,
): Promise<boolean> {
  const cur = Number((await kv.get(key)) ?? "0");
  const next = cur + amount;
  if (next > limit) return false;
  // TTL to midnight UTC — simple daily bucket.
  await kv.put(key, String(next), { expirationTtl: 60 * 60 * 26 });
  return true;
}

async function sha256Hex(text: string) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

app.get("/", (c) => c.text("koe-worker ok"));

// ---- TTS ---------------------------------------------------------------

app.post("/tts", async (c) => {
  const trace = workerTrace(c.req.raw.headers);
  const { text, speed = 1.0 } = await c.req.json<{
    text: string;
    speed?: number;
  }>();
  if (!text) return c.text("text required", 400);
  workerEvent("standalone_tts_request", trace, {
    voiceId: KOE_V1_VOICE_ID,
    declaredEncoding: INWORLD_STANDALONE_AUDIO_CONTRACT.encoding,
    sampleRate: INWORLD_STANDALONE_AUDIO_CONTRACT.sampleRate,
    channels: INWORLD_STANDALONE_AUDIO_CONTRACT.channels,
  });

  const dev = deviceId(c);
  const ok = await bumpCounter(
    c.env.KOE_KV,
    `rl:tts:${dev}:${today()}`,
    1,
    Number(c.env.RATE_LIMIT_TTS),
  );
  if (!ok) return c.text("rate limit", 429);

  // Cache key (KV holds pointer to R2 object; in v1 we just re-synth if missing).
  const cacheKey = `tts:${await sha256Hex(`v1:${KOE_V1_VOICE_ID}|${text}|${speed}`)}`;
  const cached = await c.env.KOE_KV.get(cacheKey, "arrayBuffer");
  if (cached) {
    workerEvent("standalone_tts_cache_hit", trace, {
      byteCount: cached.byteLength,
    });
    return new Response(cached, {
      headers: {
        "Content-Type": INWORLD_STANDALONE_AUDIO_CONTRACT.contentType,
        ...standaloneResponseHeaders,
        "X-Koe-Voice-Id": KOE_V1_VOICE_ID,
        "X-Koe-Provider-Request-Id": "cache",
        "X-Koe-Response-Run-Id": trace.responseRunId,
      },
    });
  }

  const inworldRes = await fetch(`${c.env.INWORLD_API_BASE_URL}/tts/v1/voice`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${c.env.INWORLD_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voiceId: KOE_V1_VOICE_ID,
      modelId: c.env.INWORLD_MODEL || "inworld-tts-1.5-max",
      audioConfig: { audioEncoding: "MP3", sampleRateHertz: 24000 },
    }),
  });
  const requestId = providerRequestId(inworldRes);
  workerEvent(
    "provider_response",
    trace,
    {
      endpoint: "tts",
      status: inworldRes.status,
      providerRequestId: requestId,
      contentType: inworldRes.headers.get("Content-Type") ?? "none",
    },
    inworldRes.ok ? "info" : "error",
  );

  if (!inworldRes.ok) {
    return c.text("inworld tts failed", 502);
  }

  const payload = (await inworldRes.json()) as {
    audioContent?: string;
    durationMs?: number;
  };
  let bin: Uint8Array;
  try {
    bin = validateStandaloneAudio(payload.audioContent ?? "");
  } catch (error) {
    workerEvent(
      "provider_contract_failed",
      trace,
      {
        endpoint: "tts",
        failureKind:
          error instanceof ProviderContractError ? error.kind : "unknown",
        providerRequestId: requestId,
      },
      "error",
    );
    return c.text("inworld tts audio contract failed", 502);
  }
  workerEvent("standalone_tts_decoded", trace, {
    providerRequestId: requestId,
    declaredEncoding: INWORLD_STANDALONE_AUDIO_CONTRACT.encoding,
    observedEncoding: INWORLD_STANDALONE_AUDIO_CONTRACT.encoding,
    sampleRate: INWORLD_STANDALONE_AUDIO_CONTRACT.sampleRate,
    channels: INWORLD_STANDALONE_AUDIO_CONTRACT.channels,
    byteCount: bin.byteLength,
  });

  // Cache audio up to 25MB (KV limit). Larger fallbacks to R2 if bound.
  if (bin.byteLength < 25 * 1024 * 1024) {
    await c.env.KOE_KV.put(cacheKey, bin, { expirationTtl: 60 * 60 * 24 * 90 });
  }

  return new Response(bin, {
    headers: {
      "Content-Type": "audio/mpeg",
      "X-Duration-Ms": String(payload.durationMs ?? 0),
      ...standaloneResponseHeaders,
      "X-Koe-Voice-Id": KOE_V1_VOICE_ID,
      "X-Koe-Provider-Request-Id": requestId ?? "unavailable",
      "X-Koe-Response-Run-Id": trace.responseRunId,
    },
  });
});

// ---- STT transcribe (file upload → async REST) -------------------------

app.post("/stt/transcribe", async (c) => {
  const trace = workerTrace(c.req.raw.headers);
  const dev = deviceId(c);
  const ok = await bumpCounter(
    c.env.KOE_KV,
    `rl:stt:${dev}:${today()}`,
    30,
    Number(c.env.RATE_LIMIT_STT_SECONDS),
  );
  if (!ok) return c.text("rate limit", 429);

  const audioBytes = await c.req.arrayBuffer();
  if (!audioBytes.byteLength) return c.text("empty audio", 400);
  workerEvent("stt_started", trace, {
    path: "async-rest",
    byteCount: audioBytes.byteLength,
  });

  const langParam = c.req.query("lang") ?? "ja,en";
  const languageHints = langParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const auth = `Bearer ${c.env.SONIOX_API_KEY}`;

  const uploadForm = new FormData();
  uploadForm.append("file", new Blob([audioBytes]), "audio.m4a");
  const uploadRes = await fetch("https://api.soniox.com/v1/files", {
    method: "POST",
    headers: { Authorization: auth },
    body: uploadForm,
  });
  workerEvent(
    "provider_response",
    trace,
    {
      endpoint: "stt-upload",
      status: uploadRes.status,
      providerRequestId: providerRequestId(uploadRes),
    },
    uploadRes.ok ? "info" : "error",
  );
  if (!uploadRes.ok) return c.text("soniox upload failed", 502);
  const { id: fileId } = (await uploadRes.json()) as { id: string };

  const createRes = await fetch("https://api.soniox.com/v1/transcriptions", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "stt-async-v4",
      file_id: fileId,
      language_hints: languageHints,
    }),
  });
  workerEvent(
    "provider_response",
    trace,
    {
      endpoint: "stt-create",
      status: createRes.status,
      providerRequestId: providerRequestId(createRes),
    },
    createRes.ok ? "info" : "error",
  );
  if (!createRes.ok) return c.text("soniox transcription creation failed", 502);
  const { id: txId } = (await createRes.json()) as { id: string };

  const deadline = Date.now() + 25_000;
  let status: string = "processing";
  let errorMessage: string | undefined;
  while (Date.now() < deadline) {
    const s = await fetch(`https://api.soniox.com/v1/transcriptions/${txId}`, {
      headers: { Authorization: auth },
    });
    if (!s.ok) return c.text("soniox status failed", 502);
    const body = (await s.json()) as { status: string; error_message?: string };
    status = body.status;
    errorMessage = body.error_message;
    if (status === "completed" || status === "error") break;
    await new Promise((r) => setTimeout(r, 400));
  }
  if (status !== "completed") {
    workerEvent(
      "stt_failed",
      trace,
      {
        failureKind: status === "processing" ? "timeout" : "provider",
        providerStatus: status,
      },
      "error",
    );
    return c.text(`soniox ${status}: ${errorMessage ?? "timeout"}`, 502);
  }

  const trRes = await fetch(
    `https://api.soniox.com/v1/transcriptions/${txId}/transcript`,
    {
      headers: { Authorization: auth },
    },
  );
  if (!trRes.ok) return c.text("soniox transcript failed", 502);
  const { tokens } = (await trRes.json()) as {
    tokens: Array<{ text: string }>;
  };
  const text = tokens
    .map((t) => t.text)
    .join("")
    .trim();
  workerEvent("stt_final", trace, {
    transcriptChars: text.length,
    providerStatus: status,
  });

  c.executionCtx.waitUntil(
    Promise.all([
      fetch(`https://api.soniox.com/v1/transcriptions/${txId}`, {
        method: "DELETE",
        headers: { Authorization: auth },
      }),
      fetch(`https://api.soniox.com/v1/files/${fileId}`, {
        method: "DELETE",
        headers: { Authorization: auth },
      }),
    ])
      .then(() => undefined)
      .catch(() => undefined),
  );

  return c.json({ text });
});

// ---- STT token (deprecated: kept for dev-client fallback) --------------

app.get("/stt/token", async (c) => {
  const dev = deviceId(c);
  const ok = await bumpCounter(
    c.env.KOE_KV,
    `rl:stt:${dev}:${today()}`,
    30,
    Number(c.env.RATE_LIMIT_STT_SECONDS),
  );
  if (!ok) return c.text("rate limit", 429);

  // Soniox issues a short-lived "temporary API key" from an admin key.
  const res = await fetch("https://api.soniox.com/v1/auth/temporary-api-key", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.SONIOX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      usage_type: "transcribe_websocket",
      expires_in_seconds: 600,
    }),
  });
  if (!res.ok) {
    return c.text("soniox token failed", 502);
  }
  const data = (await res.json()) as { api_key?: string; expires_at?: string };
  return c.json({
    token: data.api_key ?? "",
    url: "wss://stt-rt.soniox.com/transcribe-websocket",
    expiresAt: Date.parse(
      data.expires_at ?? new Date(Date.now() + 10 * 60_000).toISOString(),
    ),
  });
});

// ---- LLM chat (Inworld Router: Claude Opus 4.7 + Asuka TTS) -----------

app.post("/llm/chat", async (c) => {
  const trace = workerTrace(c.req.raw.headers);
  const body = await c.req.json<{
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    model?: string;
    maxTokens?: number;
    noAudio?: boolean;
    stream?: boolean;
  }>();

  const dev = deviceId(c);
  const ok = await bumpCounter(
    c.env.KOE_KV,
    `rl:llm:${dev}:${today()}`,
    1,
    Number(c.env.RATE_LIMIT_LLM),
  );
  if (!ok) return c.text("rate limit", 429);

  const messages = [{ role: "system", content: body.system }, ...body.messages];

  const stream = body.stream !== false;
  workerEvent("provider_request_started", trace, {
    endpoint: "chat",
    stream,
    voiceId: KOE_V1_VOICE_ID,
  });
  const chatRes = await fetch(
    `${c.env.INWORLD_API_BASE_URL}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${c.env.INWORLD_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: body.model ?? "mistral/mistral-small-2603",
        max_tokens: body.maxTokens ?? 600,
        stream,
        ...(!body.noAudio && stream
          ? {
              audio: {
                voice: KOE_V1_VOICE_ID,
                model: c.env.INWORLD_MODEL || "inworld-tts-1.5-max",
              },
            }
          : {}),
        messages,
      }),
    },
  );
  const chatRequestId = providerRequestId(chatRes);
  workerEvent(
    "provider_response",
    trace,
    {
      endpoint: "chat",
      status: chatRes.status,
      providerRequestId: chatRequestId,
      contentType: chatRes.headers.get("Content-Type") ?? "none",
    },
    chatRes.ok ? "info" : "error",
  );

  if (!chatRes.ok) {
    return c.text("inworld chat failed", 502);
  }

  if (stream) {
    if (!chatRes.body) return c.text("inworld chat returned no stream", 502);
    return new Response(inspectRouterStream(chatRes, trace), {
      status: chatRes.status,
      headers: {
        "Content-Type":
          chatRes.headers.get("Content-Type") ??
          "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
        ...routerResponseHeaders,
        "X-Koe-Voice-Id": KOE_V1_VOICE_ID,
        "X-Koe-Provider-Request-Id": chatRequestId ?? "unavailable",
        "X-Koe-Response-Run-Id": trace.responseRunId,
      },
    });
  }

  const chatData = (await chatRes.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = (chatData.choices?.[0]?.message?.content ?? "").trim();

  if (body.noAudio || !text) {
    return c.json({ text, audioBase64: undefined, audioFormat: "none" });
  }

  const ttsRes = await fetch(`${c.env.INWORLD_API_BASE_URL}/tts/v1/voice`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${c.env.INWORLD_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voiceId: KOE_V1_VOICE_ID,
      modelId: c.env.INWORLD_MODEL || "inworld-tts-1.5-max",
      audioConfig: { audioEncoding: "MP3", sampleRateHertz: 24000 },
    }),
  });
  const ttsRequestId = providerRequestId(ttsRes);
  workerEvent(
    "provider_response",
    trace,
    {
      endpoint: "chat-fallback-tts",
      status: ttsRes.status,
      providerRequestId: ttsRequestId,
      contentType: ttsRes.headers.get("Content-Type") ?? "none",
    },
    ttsRes.ok ? "info" : "error",
  );

  if (!ttsRes.ok) {
    return c.json({
      text,
      audioBase64: undefined,
      audioFormat: "none",
      ttsError: "provider-failed",
    });
  }

  const ttsData = (await ttsRes.json()) as { audioContent?: string };
  let audioBase64: string | undefined;
  let audioFormat: string = "unknown";
  if (ttsData.audioContent) {
    try {
      const decoded = validateStandaloneAudio(ttsData.audioContent);
      audioBase64 = ttsData.audioContent;
      audioFormat = INWORLD_STANDALONE_AUDIO_CONTRACT.encoding;
      workerEvent("standalone_tts_decoded", trace, {
        endpoint: "chat-fallback-tts",
        providerRequestId: ttsRequestId,
        declaredEncoding: INWORLD_STANDALONE_AUDIO_CONTRACT.encoding,
        observedEncoding: audioFormat,
        sampleRate: INWORLD_STANDALONE_AUDIO_CONTRACT.sampleRate,
        channels: INWORLD_STANDALONE_AUDIO_CONTRACT.channels,
        byteCount: decoded.byteLength,
      });
    } catch (error) {
      workerEvent(
        "provider_contract_failed",
        trace,
        {
          endpoint: "chat-fallback-tts",
          failureKind:
            error instanceof ProviderContractError ? error.kind : "unknown",
          providerRequestId: ttsRequestId,
        },
        "error",
      );
      return c.json(
        {
          text,
          audioBase64: undefined,
          audioFormat: "none",
          ttsError: "audio-contract-failed",
        },
        502,
      );
    }
  }

  return c.json({
    text,
    audioBase64,
    audioFormat,
    sampleRate: INWORLD_STANDALONE_AUDIO_CONTRACT.sampleRate,
    channels: INWORLD_STANDALONE_AUDIO_CONTRACT.channels,
    voiceId: KOE_V1_VOICE_ID,
  });
});

// ---- LLM flash (Gemini) -------------------------------------------------

app.post("/llm/flash", async (c) => {
  const trace = workerTrace(c.req.raw.headers);
  const body = await c.req.json<{
    task?: string;
    history?: unknown;
    userTurn?: string;
    tutorReply?: string;
  }>();
  const dev = deviceId(c);
  const ok = await bumpCounter(
    c.env.KOE_KV,
    `rl:flash:${dev}:${today()}`,
    1,
    Number(c.env.RATE_LIMIT_LLM),
  );
  if (!ok) return c.text("rate limit", 429);

  const task = body.task;
  let prompt: string;

  if (task === "feedback") {
    prompt = `You are Koe's quiet feedback layer. Analyze the learner's latest utterance silently and never write the conversational response.

Prior dialogue: ${JSON.stringify(body.history ?? [])}
User's utterance: ${JSON.stringify(body.userTurn ?? "")}
Conversation reply: ${JSON.stringify(body.tutorReply ?? "")}

ESSENTIAL FEEDBACK CONTRACT:
- Never praise, score, teach, or manufacture a problem for a natural understandable utterance.
- Return at most one compact correction, and only when one issue materially changes the meaning or makes the utterance notably unnatural.
- Prefer the smallest useful replacement and a one-sentence explanation.
- A compact note supplements the separate conversation reply; it must never demand a retry or assign an exercise.
- If the learner explicitly asks for strict correction, translation, or teaching, analyze as requested. Even then, keep this payload to corrections only; the conversation reply handles the direct answer.

Return ONLY valid JSON:
{
  "translations": {
    "user": "a concise natural English translation of the user's utterance",
    "tutor": "a concise natural English translation of the conversation reply"
  },
  "corrections": {
    "particles": [{"original":"は","corrected":"が","explanation":"one sentence"}],
    "register": {"consistent": true, "note": null},
    "other": [{"original":"行きます","corrected":"参ります","explanation":"one sentence"}]
  }
}
Always translate both nonempty utterances. Unless correction is clearly useful under the contract, return empty arrays and register.consistent=true.`;
  } else {
    return c.text(`unknown task: ${task}`, 400);
  }

  const gemRes = await fetch(
    `${c.env.GEMINI_API_BASE_URL}/v1beta/models/${c.env.GEMINI_FLASH_MODEL}:generateContent?key=${c.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
    },
  );
  workerEvent(
    "provider_response",
    trace,
    {
      endpoint: "feedback",
      status: gemRes.status,
      providerRequestId: providerRequestId(gemRes),
      contentType: gemRes.headers.get("Content-Type") ?? "none",
    },
    gemRes.ok ? "info" : "error",
  );
  if (!gemRes.ok) return c.text("gemini feedback failed", 502);
  const data = (await gemRes.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  try {
    return new Response(text, {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return c.json({ error: "gemini returned non-JSON", raw: text }, 502);
  }
});

// ---- Furigana (Gemini, KV-cached) --------------------------------------

app.post("/furigana", async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  if (!text) return c.text("text required", 400);
  const key = `furi:${await sha256Hex(text)}`;
  const cached = await c.env.KOE_KV.get(key);
  if (cached) {
    return new Response(cached, {
      headers: { "Content-Type": "application/json" },
    });
  }

  const dev = deviceId(c);
  const ok = await bumpCounter(
    c.env.KOE_KV,
    `rl:furi:${dev}:${today()}`,
    1,
    Number(c.env.RATE_LIMIT_LLM),
  );
  if (!ok) return c.text("rate limit", 429);

  const prompt = `Split this Japanese text into runs where each run is either kanji with its hiragana reading, or a non-kanji chunk. Preserve order and characters exactly.
Return ONLY valid JSON: {"runs":[{"base":"今日","reading":"きょう"},{"base":"は"}]}
Text: ${text}`;

  const gemRes = await fetch(
    `${c.env.GEMINI_API_BASE_URL}/v1beta/models/${c.env.GEMINI_FLASH_MODEL}:generateContent?key=${c.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0,
        },
      }),
    },
  );
  if (!gemRes.ok) return c.text("gemini furigana failed", 502);
  const data = (await gemRes.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const out = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{"runs":[]}';
  await c.env.KOE_KV.put(key, out, { expirationTtl: 60 * 60 * 24 * 30 });
  return new Response(out, { headers: { "Content-Type": "application/json" } });
});

export default app;
