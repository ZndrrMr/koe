import {
  INWORLD_ROUTER_AUDIO_CONTRACT,
  INWORLD_STANDALONE_AUDIO_CONTRACT,
  observeMP3Audio,
} from "../../shared/inworld";
import { endsWithGenericFollowUpOffer } from "../../shared/conversationBehavior";
import {
  providerRequestId,
  workerEvent,
  type WorkerTraceContext,
} from "./telemetry";

export class ProviderContractError extends Error {
  constructor(
    public readonly kind:
      | "empty-audio"
      | "invalid-base64"
      | "invalid-frame-alignment"
      | "encoding-mismatch"
      | "sample-rate-mismatch"
      | "channel-mismatch"
      | "malformed-sse"
      | "truncated-sse",
    message: string,
  ) {
    super(message);
    this.name = "ProviderContractError";
  }
}

function decodeBase64(base64: string): Uint8Array {
  if (!base64)
    throw new ProviderContractError("empty-audio", "Provider audio was empty");
  if (
    base64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  ) {
    throw new ProviderContractError(
      "invalid-base64",
      "Provider audio was not canonical base64",
    );
  }
  try {
    const binary = atob(base64);
    if (!binary.length)
      throw new ProviderContractError(
        "empty-audio",
        "Provider audio decoded to no bytes",
      );
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch (error) {
    if (error instanceof ProviderContractError) throw error;
    throw new ProviderContractError(
      "invalid-base64",
      "Provider audio base64 could not decode",
    );
  }
}

export function detectedEncoding(bytes: Uint8Array): string {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.slice(offset, offset + length));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE")
    return "wav";
  if (bytes.length >= 4 && ascii(0, 4) === "fLaC") return "flac";
  if (bytes.length >= 4 && ascii(0, 4) === "OggS") return "ogg";
  if (bytes.length >= 3 && ascii(0, 3) === "ID3") return "mp3";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    return "mp3";
  return "unknown";
}

export function validateRouterAudio(base64: string): number {
  const bytes = decodeBase64(base64);
  const observed = detectedEncoding(bytes);
  if (observed !== "unknown") {
    throw new ProviderContractError(
      "encoding-mismatch",
      `Router declared raw PCM but returned ${observed}`,
    );
  }
  const bytesPerFrame =
    (INWORLD_ROUTER_AUDIO_CONTRACT.bitsPerSample / 8) *
    INWORLD_ROUTER_AUDIO_CONTRACT.channels;
  if (bytes.byteLength % bytesPerFrame !== 0) {
    throw new ProviderContractError(
      "invalid-frame-alignment",
      "Router PCM ended within a sample frame",
    );
  }
  return bytes.byteLength;
}

export function validateStandaloneAudio(base64: string): Uint8Array {
  const bytes = decodeBase64(base64);
  const observed = detectedEncoding(bytes);
  if (observed !== INWORLD_STANDALONE_AUDIO_CONTRACT.encoding) {
    throw new ProviderContractError(
      "encoding-mismatch",
      `Standalone TTS declared MP3 but returned ${observed}`,
    );
  }
  const audio = observeMP3Audio(bytes);
  if (!audio) {
    throw new ProviderContractError(
      "encoding-mismatch",
      "Standalone MP3 contained no valid MPEG audio frame",
    );
  }
  if (audio.sampleRate !== INWORLD_STANDALONE_AUDIO_CONTRACT.sampleRate) {
    throw new ProviderContractError(
      "sample-rate-mismatch",
      `Standalone MP3 was ${audio.sampleRate} Hz`,
    );
  }
  if (audio.channels !== INWORLD_STANDALONE_AUDIO_CONTRACT.channels) {
    throw new ProviderContractError(
      "channel-mismatch",
      `Standalone MP3 contained ${audio.channels} channels`,
    );
  }
  return bytes;
}

function extractEvents(
  buffer: string,
  flush = false,
): {
  events: string[];
  remainder: string;
} {
  let normalized = buffer.replace(/\r\n/g, "\n");
  if (flush && normalized.trim()) normalized += "\n\n";
  const blocks = normalized.split("\n\n");
  const remainder = blocks.pop() ?? "";
  return {
    events: blocks
      .map((block) =>
        block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n"),
      )
      .filter(Boolean),
    remainder,
  };
}

export function inspectRouterStream(
  upstream: Response,
  trace: WorkerTraceContext,
): ReadableStream<Uint8Array> {
  if (!upstream.body) {
    throw new ProviderContractError(
      "truncated-sse",
      "Provider returned no stream body",
    );
  }
  const requestId = providerRequestId(upstream);
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;
  let eventCount = 0;
  let audioBytes = 0;
  let replyText = "";

  const inspect = (flush: boolean) => {
    const extracted = extractEvents(buffer, flush);
    buffer = extracted.remainder;
    for (const payload of extracted.events) {
      eventCount += 1;
      if (payload === "[DONE]") {
        sawDone = true;
        workerEvent("provider_sse_event", trace, {
          eventKind: "done",
          eventIndex: eventCount,
          providerRequestId: requestId,
        });
        continue;
      }
      let parsed: {
        choices?: Array<{
          delta?: {
            content?: string;
            audio?: { data?: string; transcript?: string };
          };
        }>;
      };
      try {
        parsed = JSON.parse(payload);
      } catch {
        throw new ProviderContractError(
          "malformed-sse",
          "Provider returned malformed SSE JSON",
        );
      }
      const delta = parsed.choices?.[0]?.delta;
      replyText += delta?.audio?.transcript ?? delta?.content ?? "";
      const eventKind =
        delta?.audio && "data" in delta.audio
          ? "audio"
          : delta?.audio?.transcript !== undefined
            ? "audio-transcript"
            : delta?.content !== undefined
              ? "text"
              : "metadata";
      let byteCount = 0;
      if (delta?.audio && "data" in delta.audio) {
        byteCount = validateRouterAudio(delta.audio.data ?? "");
        audioBytes += byteCount;
      }
      workerEvent("provider_sse_event", trace, {
        eventKind,
        eventIndex: eventCount,
        providerRequestId: requestId,
        declaredEncoding: INWORLD_ROUTER_AUDIO_CONTRACT.encoding,
        observedEncoding:
          eventKind === "audio"
            ? INWORLD_ROUTER_AUDIO_CONTRACT.encoding
            : undefined,
        sampleRate: INWORLD_ROUTER_AUDIO_CONTRACT.sampleRate,
        channels: INWORLD_ROUTER_AUDIO_CONTRACT.channels,
        byteCount,
        totalByteCount: audioBytes,
      });
    }
  };

  return upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        try {
          inspect(false);
          controller.enqueue(chunk);
        } catch (error) {
          workerEvent(
            "provider_contract_failed",
            trace,
            {
              failureKind:
                error instanceof ProviderContractError ? error.kind : "unknown",
              providerRequestId: requestId,
            },
            "error",
          );
          throw error;
        }
      },
      flush() {
        buffer += decoder.decode();
        try {
          inspect(true);
          if (!sawDone || buffer.trim()) {
            throw new ProviderContractError(
              "truncated-sse",
              "Provider stream ended before [DONE]",
            );
          }
          workerEvent("provider_stream_completed", trace, {
            providerRequestId: requestId,
            eventCount,
            byteCount: audioBytes,
            replyChars: replyText.trim().length,
            genericFollowUpOffer: endsWithGenericFollowUpOffer(replyText),
          });
        } catch (error) {
          workerEvent(
            "provider_contract_failed",
            trace,
            {
              failureKind:
                error instanceof ProviderContractError ? error.kind : "unknown",
              providerRequestId: requestId,
            },
            "error",
          );
          throw error;
        }
      },
    }),
  );
}

export const routerResponseHeaders = {
  "X-Koe-Audio-Encoding": INWORLD_ROUTER_AUDIO_CONTRACT.encoding,
  "X-Koe-Audio-Sample-Rate": String(INWORLD_ROUTER_AUDIO_CONTRACT.sampleRate),
  "X-Koe-Audio-Channels": String(INWORLD_ROUTER_AUDIO_CONTRACT.channels),
};

export const standaloneResponseHeaders = {
  "X-Koe-Audio-Encoding": INWORLD_STANDALONE_AUDIO_CONTRACT.encoding,
  "X-Koe-Audio-Sample-Rate": String(
    INWORLD_STANDALONE_AUDIO_CONTRACT.sampleRate,
  ),
  "X-Koe-Audio-Channels": String(INWORLD_STANDALONE_AUDIO_CONTRACT.channels),
};
