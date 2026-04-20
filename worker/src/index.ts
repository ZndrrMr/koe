/**
 * Koe edge proxy (Cloudflare Worker).
 *
 * Routes:
 *   POST /tts        → Inworld TTS, streams audio (mp3) back
 *   GET  /stt/token  → returns a short-lived Soniox streaming URL + temp key
 *   POST /llm/chat   → proxies Gemini 3.1 Flash-Lite streaming (SSE pass-through)
 *   POST /llm/flash  → proxies Gemini 3.1 Flash-Lite for suggestions/grading/examples
 *   POST /furigana   → Gemini-powered furigana annotation with KV caching
 *
 * Secrets (wrangler secret put):
 *   INWORLD_API_KEY, SONIOX_API_KEY, GEMINI_API_KEY
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Env = {
  KOE_KV: KVNamespace;
  INWORLD_API_KEY: string;
  SONIOX_API_KEY: string;
  GEMINI_API_KEY: string;
  RATE_LIMIT_TTS: string;
  RATE_LIMIT_LLM: string;
  RATE_LIMIT_STT_SECONDS: string;
  INWORLD_MODEL: string;
  GEMINI_TUTOR_MODEL: string;
  GEMINI_FLASH_MODEL: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function deviceId(c: any): string {
  return c.req.header('X-Device-Id') ?? 'anon';
}

async function bumpCounter(kv: KVNamespace, key: string, amount: number, limit: number): Promise<boolean> {
  const cur = Number((await kv.get(key)) ?? '0');
  const next = cur + amount;
  if (next > limit) return false;
  // TTL to midnight UTC — simple daily bucket.
  await kv.put(key, String(next), { expirationTtl: 60 * 60 * 26 });
  return true;
}

async function sha256Hex(text: string) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

app.get('/', (c) => c.text('koe-worker ok'));

// ---- TTS ---------------------------------------------------------------

app.post('/tts', async (c) => {
  const { text, voice = 'ja-female-1', speed = 1.0 } = await c.req.json<{
    text: string; voice?: string; speed?: number;
  }>();
  if (!text) return c.text('text required', 400);

  const dev = deviceId(c);
  const ok = await bumpCounter(c.env.KOE_KV, `rl:tts:${dev}:${today()}`, 1, Number(c.env.RATE_LIMIT_TTS));
  if (!ok) return c.text('rate limit', 429);

  // Cache key (KV holds pointer to R2 object; in v1 we just re-synth if missing).
  const cacheKey = `tts:${await sha256Hex(`${text}|${voice}|${speed}`)}`;
  const cached = await c.env.KOE_KV.get(cacheKey, 'arrayBuffer');
  if (cached) {
    return new Response(cached, { headers: { 'Content-Type': 'audio/mpeg' } });
  }

  const voiceMap: Record<string, string> = {
    'ja-female-1': 'Asuka',
    'ja-female-2': 'Asuka',
    'ja-male-1': 'Satoshi',
  };

  const inworldRes = await fetch('https://api.inworld.ai/tts/v1/voice', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${c.env.INWORLD_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      voiceId: voiceMap[voice] ?? 'Asuka',
      modelId: c.env.INWORLD_MODEL || 'inworld-tts-1.5-max',
      audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000 },
    }),
  });

  if (!inworldRes.ok) {
    const body = await inworldRes.text();
    return c.text(`inworld error: ${body}`, 502);
  }

  const payload = (await inworldRes.json()) as { audioContent?: string; durationMs?: number };
  if (!payload.audioContent) return c.text('inworld: empty audioContent', 502);

  const bin = Uint8Array.from(atob(payload.audioContent), (ch) => ch.charCodeAt(0));

  // Cache audio up to 25MB (KV limit). Larger fallbacks to R2 if bound.
  if (bin.byteLength < 25 * 1024 * 1024) {
    await c.env.KOE_KV.put(cacheKey, bin, { expirationTtl: 60 * 60 * 24 * 90 });
  }

  return new Response(bin, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'X-Duration-Ms': String(payload.durationMs ?? 0),
    },
  });
});

// ---- STT transcribe (file upload → async REST) -------------------------

app.post('/stt/transcribe', async (c) => {
  const dev = deviceId(c);
  const ok = await bumpCounter(
    c.env.KOE_KV, `rl:stt:${dev}:${today()}`, 30, Number(c.env.RATE_LIMIT_STT_SECONDS),
  );
  if (!ok) return c.text('rate limit', 429);

  const audioBytes = await c.req.arrayBuffer();
  if (!audioBytes.byteLength) return c.text('empty audio', 400);

  const langParam = c.req.query('lang') ?? 'ja,en';
  const languageHints = langParam.split(',').map((s) => s.trim()).filter(Boolean);

  const auth = `Bearer ${c.env.SONIOX_API_KEY}`;

  const uploadForm = new FormData();
  uploadForm.append('file', new Blob([audioBytes]), 'audio.m4a');
  const uploadRes = await fetch('https://api.soniox.com/v1/files', {
    method: 'POST',
    headers: { Authorization: auth },
    body: uploadForm,
  });
  if (!uploadRes.ok) return c.text(`soniox upload: ${await uploadRes.text()}`, 502);
  const { id: fileId } = (await uploadRes.json()) as { id: string };

  const createRes = await fetch('https://api.soniox.com/v1/transcriptions', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'stt-async-v4',
      file_id: fileId,
      language_hints: languageHints,
    }),
  });
  if (!createRes.ok) return c.text(`soniox create: ${await createRes.text()}`, 502);
  const { id: txId } = (await createRes.json()) as { id: string };

  const deadline = Date.now() + 25_000;
  let status: string = 'processing';
  let errorMessage: string | undefined;
  while (Date.now() < deadline) {
    const s = await fetch(`https://api.soniox.com/v1/transcriptions/${txId}`, {
      headers: { Authorization: auth },
    });
    if (!s.ok) return c.text(`soniox status: ${await s.text()}`, 502);
    const body = (await s.json()) as { status: string; error_message?: string };
    status = body.status;
    errorMessage = body.error_message;
    if (status === 'completed' || status === 'error') break;
    await new Promise((r) => setTimeout(r, 400));
  }
  if (status !== 'completed') {
    return c.text(`soniox ${status}: ${errorMessage ?? 'timeout'}`, 502);
  }

  const trRes = await fetch(`https://api.soniox.com/v1/transcriptions/${txId}/transcript`, {
    headers: { Authorization: auth },
  });
  if (!trRes.ok) return c.text(`soniox transcript: ${await trRes.text()}`, 502);
  const { tokens } = (await trRes.json()) as { tokens: Array<{ text: string }> };
  const text = tokens.map((t) => t.text).join('').trim();

  fetch(`https://api.soniox.com/v1/transcriptions/${txId}`, {
    method: 'DELETE',
    headers: { Authorization: auth },
  }).catch(() => {});
  fetch(`https://api.soniox.com/v1/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: auth },
  }).catch(() => {});

  return c.json({ text });
});

// ---- STT token (deprecated: kept for dev-client fallback) --------------

app.get('/stt/token', async (c) => {
  const dev = deviceId(c);
  const ok = await bumpCounter(
    c.env.KOE_KV, `rl:stt:${dev}:${today()}`, 30, Number(c.env.RATE_LIMIT_STT_SECONDS),
  );
  if (!ok) return c.text('rate limit', 429);

  // Soniox issues a short-lived "temporary API key" from an admin key.
  const res = await fetch('https://api.soniox.com/v1/auth/temporary-api-key', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.SONIOX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      usage_type: 'transcribe_websocket',
      expires_in_seconds: 600,
    }),
  });
  if (!res.ok) {
    return c.text(`soniox token: ${await res.text()}`, 502);
  }
  const data = (await res.json()) as { api_key?: string; expires_at?: string };
  return c.json({
    token: data.api_key ?? '',
    url: 'wss://stt-rt.soniox.com/transcribe-websocket',
    expiresAt: Date.parse(data.expires_at ?? new Date(Date.now() + 10 * 60_000).toISOString()),
  });
});

// ---- LLM chat (Inworld Router: Claude Opus 4.7 + Asuka TTS) -----------

function detectAudioFormat(bytes: Uint8Array): 'flac' | 'mp3' | 'ogg' | 'wav' | 'unknown' {
  if (bytes.length < 4) return 'unknown';
  if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) return 'flac';
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'ogg';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'wav';
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'mp3';
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3';
  return 'unknown';
}

app.post('/llm/chat', async (c) => {
  const body = await c.req.json<{
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    model?: string;
    voice?: string;
    maxTokens?: number;
    noAudio?: boolean;
  }>();

  const dev = deviceId(c);
  const ok = await bumpCounter(c.env.KOE_KV, `rl:llm:${dev}:${today()}`, 1, Number(c.env.RATE_LIMIT_LLM));
  if (!ok) return c.text('rate limit', 429);

  const messages = [
    { role: 'system', content: body.system },
    ...body.messages,
  ];

  const chatRes = await fetch('https://api.inworld.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${c.env.INWORLD_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: body.model ?? 'mistral/mistral-small-2603',
      max_tokens: body.maxTokens ?? 600,
      stream: false,
      messages,
    }),
  });

  if (!chatRes.ok) {
    return c.text(`inworld chat error: ${await chatRes.text().catch(() => '')}`, 502);
  }

  const chatData = (await chatRes.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = (chatData.choices?.[0]?.message?.content ?? '').trim();

  if (body.noAudio || !text) {
    return c.json({ text, audioBase64: undefined, audioFormat: 'none' });
  }

  const ttsRes = await fetch('https://api.inworld.ai/tts/v1/voice', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${c.env.INWORLD_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      voiceId: body.voice ?? 'Asuka',
      modelId: c.env.INWORLD_MODEL || 'inworld-tts-1.5-max',
      audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000 },
    }),
  });

  if (!ttsRes.ok) {
    return c.json({ text, audioBase64: undefined, audioFormat: 'none', ttsError: (await ttsRes.text().catch(() => '')) });
  }

  const ttsData = (await ttsRes.json()) as { audioContent?: string };
  let audioBase64: string | undefined;
  let audioFormat: string = 'unknown';
  if (ttsData.audioContent) {
    audioBase64 = ttsData.audioContent;
    const head = Uint8Array.from(atob(ttsData.audioContent.slice(0, 12)), (ch) => ch.charCodeAt(0));
    audioFormat = detectAudioFormat(head);
    if (audioFormat === 'unknown') audioFormat = 'mp3';
  }

  return c.json({ text, audioBase64, audioFormat });
});

// ---- LLM flash (Gemini) -------------------------------------------------

app.post('/llm/flash', async (c) => {
  const body = await c.req.json<any>();
  const dev = deviceId(c);
  const ok = await bumpCounter(c.env.KOE_KV, `rl:flash:${dev}:${today()}`, 1, Number(c.env.RATE_LIMIT_LLM));
  if (!ok) return c.text('rate limit', 429);

  const task = body.task as string;
  let prompt: string;

  if (task === 'suggest-replies') {
    prompt = `You are helping a Japanese learner. Given this short dialogue, propose 3 plausible learner replies in ${body.registerTarget ?? 'teineigo'} register at JLPT N${body.jlptTarget ?? 5}.
Return ONLY valid JSON: {"replies":[{"ja":"...","en":"...","hint":"..."}]}.
Dialogue: ${JSON.stringify(body.history ?? [])}`;
  } else if (task === 'grade-pronunciation') {
    prompt = `Grade this pronunciation attempt. Target: "${body.targetText}". User transcript: "${body.userTranscript}". Native F0: ${JSON.stringify((body.nativePitchContour ?? []).slice(0, 40))}. User F0: ${JSON.stringify((body.userPitchContour ?? []).slice(0, 40))}.
Return ONLY valid JSON: {"phonemeScore":0-100,"pitchScore":0-100,"overallScore":0-100,"notes":["..."]}.`;
  } else if (task === 'examples') {
    prompt = `Give 3 natural example sentences using the word ${body.word} (reading: ${body.kana}, meaning: ${body.gloss}). Keep them JLPT N5-N4 level. Return ONLY valid JSON: {"examples":["...","...","..."]}.`;
  } else if (task === 'feedback') {
    prompt = `You analyze a Japanese tutoring exchange silently.
TARGET REGISTER: ${body.registerTarget ?? 'teineigo'}
TARGET LEVEL: JLPT N${body.jlptTarget ?? 5}
Prior dialogue: ${JSON.stringify(body.history ?? [])}
User's utterance: ${JSON.stringify(body.userTurn ?? '')}
Tutor's reply: ${JSON.stringify(body.tutorReply ?? '')}

Return ONLY valid JSON:
{
  "translation": "English translation of the tutor's reply",
  "corrections": {
    "particles": [{"original":"は","corrected":"が","explanation":"one sentence"}],
    "register": {"consistent": true, "note": null},
    "other": [{"original":"行きます","corrected":"参ります","explanation":"one sentence"}]
  }
}
If the user's Japanese is fine, return empty arrays and register.consistent=true.`;
  } else {
    return c.text(`unknown task: ${task}`, 400);
  }

  const gemRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${c.env.GEMINI_FLASH_MODEL}:generateContent?key=${c.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
    },
  );
  if (!gemRes.ok) return c.text(`gemini error: ${await gemRes.text()}`, 502);
  const data = (await gemRes.json()) as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  try {
    return new Response(text, { headers: { 'Content-Type': 'application/json' } });
  } catch {
    return c.json({ error: 'gemini returned non-JSON', raw: text }, 502);
  }
});

// ---- Furigana (Gemini, KV-cached) --------------------------------------

app.post('/furigana', async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  if (!text) return c.text('text required', 400);
  const key = `furi:${await sha256Hex(text)}`;
  const cached = await c.env.KOE_KV.get(key);
  if (cached) {
    return new Response(cached, { headers: { 'Content-Type': 'application/json' } });
  }

  const dev = deviceId(c);
  const ok = await bumpCounter(c.env.KOE_KV, `rl:furi:${dev}:${today()}`, 1, Number(c.env.RATE_LIMIT_LLM));
  if (!ok) return c.text('rate limit', 429);

  const prompt = `Split this Japanese text into runs where each run is either kanji with its hiragana reading, or a non-kanji chunk. Preserve order and characters exactly.
Return ONLY valid JSON: {"runs":[{"base":"今日","reading":"きょう"},{"base":"は"}]}
Text: ${text}`;

  const gemRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${c.env.GEMINI_FLASH_MODEL}:generateContent?key=${c.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    },
  );
  if (!gemRes.ok) return c.text(`gemini error: ${await gemRes.text()}`, 502);
  const data = (await gemRes.json()) as any;
  const out = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{"runs":[]}';
  await c.env.KOE_KV.put(key, out, { expirationTtl: 60 * 60 * 24 * 30 });
  return new Response(out, { headers: { 'Content-Type': 'application/json' } });
});

export default app;
