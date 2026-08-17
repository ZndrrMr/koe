import { createServer } from "node:http";
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

async function streamRouterFixture(response) {
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
      choices: [{ delta: { audio: { transcript: "こんにちは。" } } }],
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
    void streamRouterFixture(response);
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

server.listen(8_790, "127.0.0.1", () => {
  console.log(
    JSON.stringify({
      event: "voice_contract_fixture_server_ready",
      port: 8_790,
    }),
  );
});
