import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

const fixture = JSON.parse(
  readFileSync(
    new URL("../shared/fixtures/inworldAudioContract.json", import.meta.url),
    "utf8",
  ),
);
const spokenManifest = JSON.parse(
  readFileSync(
    new URL("../shared/fixtures/spoken/manifest.json", import.meta.url),
    "utf8",
  ),
);
const spokenTranscriptByFilename = new Map(
  spokenManifest.assets.map((asset) => [
    asset.file.split("/").pop(),
    asset.expectedTranscript,
  ]),
);

const pcm = Buffer.from(fixture.routerStream.audioBase64, "base64");
const chunks = [];
for (let offset = 0; offset < pcm.length; offset += 1_920) {
  chunks.push(pcm.subarray(offset, offset + 1_920).toString("base64"));
}
const routerChunkDelayMs = Number(process.env.KOE_ROUTER_CHUNK_DELAY_MS ?? 0);
const routerInitialDelayMs = Number(
  process.env.KOE_ROUTER_INITIAL_DELAY_MS ?? 0,
);
const realtimeSttFixture = process.env.KOE_REALTIME_STT_FIXTURE === "1";
let realtimeConnectionCount = 0;
let realtimeReplyCount = 0;

const realtimeTurns = [
  [
    { text: "日本語は", is_final: true, confidence: 0.99, language: "ja" },
    {
      text: " okay, but can we switch to English?",
      is_final: true,
      confidence: 0.99,
      language: "en",
    },
  ],
  [
    {
      text: "はい、日本語に戻りましょう。",
      is_final: true,
      confidence: 0.99,
      language: "ja",
    },
  ],
];

const recordedFixtureDirectory = process.env.KOE_RECORDED_FIXTURE_DIR;
const recordedContentTypes = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
};

function json(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(value));
}

async function streamRouterFixture(response, transcript = "こんにちは。") {
  if (routerInitialDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, routerInitialDelayMs));
  }
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Request-Id": "fixture-router-request",
    "X-Koe-Audio-Encoding": fixture.routerStream.encoding,
    "X-Koe-Audio-Sample-Rate": String(fixture.routerStream.sampleRate),
    "X-Koe-Audio-Channels": String(fixture.routerStream.channels),
  });
  response.write(
    `data: ${JSON.stringify({
      choices: [{ delta: { audio: { transcript } } }],
    })}\n\n`,
  );
  for (const data of chunks) {
    response.write(
      `data: ${JSON.stringify({
        choices: [{ delta: { audio: { data } } }],
      })}\n\n`,
    );
    if (routerChunkDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, routerChunkDelayMs));
    }
  }
  response.end("data: [DONE]\n\n");
}

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://fixture.invalid");
  console.log(
    JSON.stringify({
      event: "voice_contract_fixture_request",
      method: request.method,
      path: requestUrl.pathname,
    }),
  );

  if (request.method === "GET" && requestUrl.pathname === "/stt/token") {
    json(
      response,
      200,
      {
        token: "fixture-invalid-soniox-temporary-key",
        url: realtimeSttFixture
          ? "ws://127.0.0.1:8790/soniox-realtime"
          : "wss://stt-rt.soniox.com/transcribe-websocket",
        expiresAt: Date.now() + 60_000,
      },
      { "Cache-Control": "no-store" },
    );
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/stt/transcribe") {
    request.resume();
    const encodedFilename = request.headers["x-koe-audio-filename"];
    const filename = decodeURIComponent(
      Array.isArray(encodedFilename)
        ? (encodedFilename[0] ?? "")
        : (encodedFilename ?? ""),
    );
    json(response, 200, {
      text:
        spokenTranscriptByFilename.get(filename) ?? "明日は京都へ行きます。",
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/llm/chat") {
    request.resume();
    const reply = realtimeSttFixture
      ? realtimeReplyCount++ === 0
        ? "Of course—we can switch to English. How was your day?"
        : "はい、日本語に戻りましょう。今日はどうでしたか？"
      : "こんにちは。";
    void streamRouterFixture(response, reply);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/llm/flash") {
    request.resume();
    json(response, 200, {
      translations: { user: "Fixture learner turn.", tutor: "Hello." },
      corrections: {
        particles: [],
        register: { consistent: true },
        other: [],
      },
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/furigana") {
    request.resume();
    json(response, 200, { runs: [{ base: "こんにちは。" }] });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/tts") {
    response.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(
        Buffer.from(fixture.standalone.audioBase64, "base64").byteLength,
      ),
      "X-Duration-Ms": "300",
      "X-Koe-Audio-Encoding": fixture.standalone.encoding,
      "X-Koe-Audio-Sample-Rate": String(fixture.standalone.sampleRate),
      "X-Koe-Audio-Channels": String(fixture.standalone.channels),
    });
    response.end(Buffer.from(fixture.standalone.audioBase64, "base64"));
    return;
  }

  if (
    request.method === "GET" &&
    requestUrl.pathname.startsWith("/recorded/") &&
    recordedFixtureDirectory
  ) {
    const filename = requestUrl.pathname.split("/").pop() ?? "";
    const extension = extname(filename).toLowerCase();
    const contentType = recordedContentTypes[extension];
    const path = join(recordedFixtureDirectory, filename);
    if (!contentType || !existsSync(path)) {
      json(response, 404, { error: "fixture-not-found" });
      return;
    }
    const bytes = readFileSync(path);
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    });
    response.end(bytes);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/v1/chat/completions"
  ) {
    void streamRouterFixture(response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/tts/v1/voice") {
    json(
      response,
      200,
      {
        audioContent: fixture.standalone.audioBase64,
        durationMs: 300,
      },
      { "X-Request-Id": "fixture-tts-request" },
    );
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname.startsWith("/v1beta/models/")
  ) {
    json(response, 200, {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  translations: {
                    user: "Hello.",
                    tutor: "Hello.",
                  },
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
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/v1/files") {
    request.resume();
    json(response, 201, {
      id: "fixture-file-id",
      filename: "preserved-by-worker",
      size: Number(request.headers["content-length"] ?? 0),
      created_at: new Date().toISOString(),
    });
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/v1/transcriptions"
  ) {
    request.resume();
    json(response, 200, { id: "fixture-transcription-id" });
    return;
  }

  if (
    request.method === "GET" &&
    requestUrl.pathname ===
      "/v1/transcriptions/fixture-transcription-id/transcript"
  ) {
    json(response, 200, {
      tokens: [{ text: "明日は" }, { text: "京都へ行きます。" }],
    });
    return;
  }

  if (
    request.method === "GET" &&
    requestUrl.pathname === "/v1/transcriptions/fixture-transcription-id"
  ) {
    json(response, 200, { status: "completed" });
    return;
  }

  if (
    request.method === "DELETE" &&
    (requestUrl.pathname === "/v1/files/fixture-file-id" ||
      requestUrl.pathname === "/v1/transcriptions/fixture-transcription-id")
  ) {
    response.writeHead(204);
    response.end();
    return;
  }

  json(response, 404, { error: "not-found" });
});

function websocketTextFrame(value) {
  const payload = Buffer.from(value, "utf8");
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function decodeWebSocketFrames(pending) {
  const frames = [];
  let offset = 0;
  while (pending.length - offset >= 2) {
    const first = pending[offset];
    const second = pending[offset + 1];
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (pending.length - offset < 4) break;
      length = pending.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (pending.length - offset < 10) break;
      const extendedLength = Number(pending.readBigUInt64BE(offset + 2));
      if (!Number.isSafeInteger(extendedLength)) break;
      length = extendedLength;
      headerLength = 10;
    }
    const masked = (second & 0x80) !== 0;
    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (pending.length - offset < frameLength) break;
    const maskOffset = offset + headerLength;
    const payloadOffset = maskOffset + maskLength;
    const payload = Buffer.from(
      pending.subarray(payloadOffset, payloadOffset + length),
    );
    if (masked) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= pending[maskOffset + (index % 4)];
      }
    }
    frames.push({ opcode: first & 0x0f, payload });
    offset += frameLength;
  }
  return { frames, pending: pending.subarray(offset) };
}

server.on("upgrade", (request, socket) => {
  if (!realtimeSttFixture || request.url !== "/soniox-realtime") {
    socket.destroy();
    return;
  }
  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );

  const turn = realtimeTurns[realtimeConnectionCount++];
  let pending = Buffer.alloc(0);
  let configured = false;
  socket.on("data", (data) => {
    pending = Buffer.concat([pending, data]);
    const decoded = decodeWebSocketFrames(pending);
    pending = decoded.pending;
    for (const frame of decoded.frames) {
      if (frame.opcode !== 1) continue;
      const text = frame.payload.toString("utf8");
      if (!configured && text) {
        configured = true;
        const config = JSON.parse(text);
        console.log(
          JSON.stringify({
            event: "realtime_stt_fixture_configured",
            model: config.model,
            languageHints: config.language_hints,
            languageIdentification: config.enable_language_identification,
            endpointDetection: config.enable_endpoint_detection,
            endpointLatencyAdjustmentLevel:
              config.endpoint_latency_adjustment_level,
            endpointSensitivity: config.endpoint_sensitivity,
            maxEndpointDelayMs: config.max_endpoint_delay_ms,
            audioFormat: config.audio_format,
            sampleRate: config.sample_rate,
            channels: config.num_channels,
          }),
        );
        if (!turn) {
          console.log(
            JSON.stringify({ event: "realtime_stt_fixture_exhausted" }),
          );
          continue;
        }
        setTimeout(() => {
          if (socket.destroyed) return;
          socket.write(
            websocketTextFrame(
              JSON.stringify({
                tokens: turn.map((token) => ({
                  ...token,
                  is_final: false,
                })),
              }),
            ),
          );
        }, 350);
        setTimeout(() => {
          if (socket.destroyed) return;
          socket.write(
            websocketTextFrame(
              JSON.stringify({
                tokens: [
                  ...turn,
                  { text: "<end>", is_final: true, confidence: 1 },
                ],
              }),
            ),
          );
        }, 700);
      } else if (configured && text.length === 0) {
        socket.write(
          websocketTextFrame(JSON.stringify({ tokens: [], finished: true })),
        );
        setTimeout(() => socket.end(), 50);
      }
    }
  });
});

server.listen(8_790, "127.0.0.1", () => {
  console.log(
    JSON.stringify({
      event: "voice_contract_fixture_server_ready",
      port: 8_790,
    }),
  );
});
