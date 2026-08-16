import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const fixture = JSON.parse(
  readFileSync(
    new URL("../shared/fixtures/inworldAudioContract.json", import.meta.url),
    "utf8",
  ),
);

const pcm = Buffer.from(fixture.routerStream.audioBase64, "base64");
const chunks = [];
for (let offset = 0; offset < pcm.length; offset += 1_920) {
  chunks.push(pcm.subarray(offset, offset + 1_920).toString("base64"));
}

function json(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(value));
}

const server = createServer((request, response) => {
  console.log(
    JSON.stringify({
      event: "voice_contract_fixture_request",
      method: request.method,
      path: request.url,
    }),
  );
  if (request.method !== "POST") {
    json(response, 404, { error: "not-found" });
    return;
  }

  if (request.url === "/v1/chat/completions") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Request-Id": "fixture-router-request",
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
    }
    response.end("data: [DONE]\n\n");
    return;
  }

  if (request.url === "/tts/v1/voice") {
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

  if (request.url?.startsWith("/v1beta/models/")) {
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
