import { postJson, postStream } from "@/services/api";
import { tutorSystemPrompt } from "@/prompts/tutor";
import { hasWorker } from "@/utils/config";
import { log } from "@/utils/log";
import {
  assertCompleteSSE,
  extractSSEEvents,
  TruncatedSSEError,
} from "@/services/sse";
import {
  AudioContractError,
  decodeBase64Audio,
  validateInworldRouterChunk,
  validateInworldStandaloneMP3,
} from "@/services/audioContract";
import {
  errorName,
  voiceEvent,
  type VoiceTraceContext,
} from "@/utils/telemetry";
import {
  INWORLD_ROUTER_AUDIO_CONTRACT,
  INWORLD_STANDALONE_AUDIO_CONTRACT,
  KOE_V1_ROUTER_MODEL,
} from "../../shared/inworld";

export type ConvoTurn = { role: "user" | "assistant"; content: string };

export type ConversationCorrections = {
  particles: Array<{
    original: string;
    corrected: string;
    explanation: string;
  }>;
  register: { consistent: boolean; note?: string };
  other: Array<{ original: string; corrected: string; explanation: string }>;
};

export type ConversationResult = {
  fullText: string;
  /** Resolves independently so coaching never delays response audio. */
  feedback: Promise<{
    corrections: ConversationCorrections;
    translations: { user?: string; tutor?: string };
  }>;
};

export type ConversationChunk =
  | { type: "text"; text: string }
  | {
      type: "audio";
      audioBase64: string;
      encoding: typeof INWORLD_ROUTER_AUDIO_CONTRACT.encoding;
      sampleRate: number;
      channels: number;
      byteCount: number;
    }
  | {
      type: "audio-file";
      audioBase64: string;
      encoding: typeof INWORLD_STANDALONE_AUDIO_CONTRACT.encoding;
      sampleRate: number;
      channels: number;
      byteCount: number;
    };

export class ProviderTimeoutError extends Error {
  constructor(message = "The conversation provider timed out") {
    super(message);
    this.name = "ProviderTimeoutError";
  }
}

export class ProviderStreamError extends Error {
  constructor(
    public readonly kind:
      | "missing-body"
      | "malformed-event"
      | "truncated"
      | "empty-response",
    message: string,
  ) {
    super(message);
    this.name = "ProviderStreamError";
  }
}

const EMPTY_CORRECTIONS = {
  particles: [] as Array<{
    original: string;
    corrected: string;
    explanation: string;
  }>,
  register: { consistent: true } as { consistent: boolean; note?: string },
  other: [] as Array<{
    original: string;
    corrected: string;
    explanation: string;
  }>,
};

export async function* streamConversation(opts: {
  history: ConvoTurn[];
  userTurn: string;
  signal?: AbortSignal;
  trace?: VoiceTraceContext;
}): AsyncGenerator<ConversationChunk, ConversationResult, void> {
  const system = tutorSystemPrompt();

  if (!hasWorker()) {
    log.warn("LLM: worker unset, yielding stub reply.");
    voiceEvent(
      "response_fallback",
      opts.trace,
      {
        path: "local-stub",
        reason: "worker-unset",
      },
      "warn",
    );
    const reply = "そうなんですね。もう少し聞かせてください。";
    yield { type: "text", text: reply };
    return {
      fullText: reply,
      feedback: Promise.resolve({
        corrections: EMPTY_CORRECTIONS,
        translations: {
          user: undefined,
          tutor: "I see. Tell me a little more.",
        },
      }),
    };
  }

  const chatBody = {
    system,
    messages: [...opts.history, { role: "user", content: opts.userTurn }],
    // The deployed Worker accepts this field too, so current app builds avoid
    // its retired historical default even before the Worker is redeployed.
    model: KOE_V1_ROUTER_MODEL,
    maxTokens: 300,
    stream: true,
  };

  const controller = new AbortController();
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const armTimeout = () => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15_000);
  };
  const abortFromCaller = () => controller.abort();
  opts.signal?.addEventListener("abort", abortFromCaller, { once: true });

  let fullText = "";
  let audioBytes = 0;
  let eventCount = 0;
  try {
    armTimeout();
    voiceEvent("provider_request_started", opts.trace, {
      endpoint: "llm-chat",
      retry: false,
    });
    const response = await postStream("/llm/chat", chatBody, {
      signal: controller.signal,
      headers: {
        "X-Koe-Session-Id": opts.trace?.sessionId ?? "",
        "X-Koe-Turn-Id": opts.trace?.turnId ?? "",
        "X-Koe-Response-Run-Id": opts.trace?.responseRunId ?? "",
      },
    });
    const providerRequestId =
      response.headers.get("X-Koe-Provider-Request-Id") ??
      response.headers.get("X-Request-Id") ??
      undefined;
    const declared = {
      encoding: response.headers.get("X-Koe-Audio-Encoding") ?? "",
      sampleRate: Number(response.headers.get("X-Koe-Audio-Sample-Rate")),
      channels: Number(response.headers.get("X-Koe-Audio-Channels")),
    };
    voiceEvent("provider_response", opts.trace, {
      status: response.status,
      providerRequestId,
      contentType: response.headers.get("Content-Type") ?? "none",
      declaredEncoding: declared.encoding || "missing",
      sampleRate: declared.sampleRate,
      channels: declared.channels,
    });

    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.toLowerCase().includes("application/json")) {
      const payload = (await response.json()) as {
        text?: string;
        audioBase64?: string;
        audioFormat?: string;
        ttsError?: string;
      };
      const text = (payload.text ?? "").trim();
      if (text) {
        eventCount += 1;
        fullText = text;
        yield { type: "text", text };
      }
      if (payload.audioBase64) {
        if (
          payload.audioFormat?.toLowerCase() !==
          INWORLD_STANDALONE_AUDIO_CONTRACT.encoding
        ) {
          throw new AudioContractError(
            "encoding-mismatch",
            `Expected legacy MP3 audio, received ${payload.audioFormat || "unknown"}`,
          );
        }
        const bytes = decodeBase64Audio(payload.audioBase64);
        const observation = validateInworldStandaloneMP3(
          bytes,
          INWORLD_STANDALONE_AUDIO_CONTRACT.contentType,
        );
        eventCount += 1;
        audioBytes = observation.byteCount;
        voiceEvent("audio_chunk_decoded", opts.trace, {
          path: "provider-json-compat",
          declaredEncoding: observation.declaredEncoding,
          observedEncoding: observation.observedEncoding,
          sampleRate: observation.sampleRate,
          channels: observation.channels,
          byteCount: observation.byteCount,
          totalByteCount: observation.byteCount,
        });
        yield {
          type: "audio-file",
          audioBase64: payload.audioBase64,
          encoding: INWORLD_STANDALONE_AUDIO_CONTRACT.encoding,
          sampleRate: observation.sampleRate,
          channels: observation.channels,
          byteCount: observation.byteCount,
        };
      } else if (payload.ttsError || text) {
        voiceEvent(
          "provider_audio_missing",
          opts.trace,
          {
            path: "provider-json-compat",
            failureKind: payload.ttsError ?? "text-only",
          },
          "warn",
        );
      }
      voiceEvent("provider_stream_completed", opts.trace, {
        path: "provider-json-compat",
        eventCount,
        byteCount: audioBytes,
      });
    } else {
      if (!response.body) {
        throw new ProviderStreamError(
          "missing-body",
          "Streaming response body is unavailable",
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let doneByProvider = false;
      while (!doneByProvider) {
        const next = await reader.read();
        if (next.done) {
          buffer += decoder.decode();
        } else {
          armTimeout();
          buffer += decoder.decode(next.value, { stream: true });
        }
        const extracted = extractSSEEvents(buffer, next.done);
        buffer = extracted.remainder;
        for (const payload of extracted.events) {
          eventCount += 1;
          if (payload === "[DONE]") {
            doneByProvider = true;
            voiceEvent("provider_sse_event", opts.trace, {
              eventKind: "done",
              eventIndex: eventCount,
            });
            break;
          }
          let event: {
            choices?: Array<{
              delta?: {
                content?: string;
                audio?: { data?: string; transcript?: string };
              };
            }>;
          };
          try {
            event = JSON.parse(payload);
          } catch {
            throw new ProviderStreamError(
              "malformed-event",
              "Provider returned malformed SSE JSON",
            );
          }
          const delta = event.choices?.[0]?.delta;
          const eventKind =
            delta?.audio?.data !== undefined
              ? "audio"
              : delta?.audio?.transcript !== undefined
                ? "audio-transcript"
                : delta?.content !== undefined
                  ? "text"
                  : "metadata";
          voiceEvent("provider_sse_event", opts.trace, {
            eventKind,
            eventIndex: eventCount,
          });
          const text = delta?.audio?.transcript ?? delta?.content ?? "";
          if (text) {
            fullText += text;
            yield { type: "text", text };
          }
          if (delta?.audio && "data" in delta.audio) {
            const observation = validateInworldRouterChunk(
              delta.audio.data ?? "",
              declared,
            );
            audioBytes += observation.byteCount;
            voiceEvent("audio_chunk_decoded", opts.trace, {
              declaredEncoding: observation.declaredEncoding,
              observedEncoding: observation.observedEncoding,
              sampleRate: observation.sampleRate,
              channels: observation.channels,
              byteCount: observation.byteCount,
              totalByteCount: audioBytes,
            });
            yield {
              type: "audio",
              audioBase64: delta.audio.data ?? "",
              encoding: INWORLD_ROUTER_AUDIO_CONTRACT.encoding,
              sampleRate: observation.sampleRate,
              channels: observation.channels,
              byteCount: observation.byteCount,
            };
          }
        }
        if (next.done) break;
      }
      try {
        assertCompleteSSE(doneByProvider, buffer);
      } catch (error) {
        if (error instanceof TruncatedSSEError) {
          throw new ProviderStreamError("truncated", error.message);
        }
        throw error;
      }
      voiceEvent("provider_stream_completed", opts.trace, {
        path: "sse",
        eventCount,
        byteCount: audioBytes,
      });
    }
  } catch (error) {
    if (timedOut) {
      voiceEvent(
        "provider_timeout",
        opts.trace,
        { timeoutMs: 15_000 },
        "error",
      );
      throw new ProviderTimeoutError();
    }
    if (controller.signal.aborted) {
      voiceEvent("provider_cancelled", opts.trace, {}, "warn");
    } else if (error instanceof AudioContractError) {
      voiceEvent(
        "audio_decode_failed",
        opts.trace,
        {
          failureKind: error.kind,
          errorName: error.name,
        },
        "error",
      );
    } else {
      voiceEvent(
        "provider_failed",
        opts.trace,
        {
          errorName: errorName(error),
          failureKind:
            error instanceof ProviderStreamError ? error.kind : "request",
        },
        "error",
      );
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    opts.signal?.removeEventListener("abort", abortFromCaller);
  }

  fullText = fullText.trim();
  if (!fullText) {
    throw new ProviderStreamError(
      "empty-response",
      "Provider returned no usable reply text",
    );
  }

  const feedback = postJson<{
    corrections?: ConversationCorrections;
    translations?: { user?: string; tutor?: string };
  }>(
    "/llm/flash",
    {
      task: "feedback",
      history: opts.history,
      userTurn: opts.userTurn,
      tutorReply: fullText,
    },
    {
      signal: opts.signal,
      headers: {
        "X-Koe-Session-Id": opts.trace?.sessionId ?? "",
        "X-Koe-Turn-Id": opts.trace?.turnId ?? "",
        "X-Koe-Response-Run-Id": opts.trace?.responseRunId ?? "",
      },
    },
  )
    .then((result) => ({
      corrections: {
        particles: result.corrections?.particles ?? [],
        register: result.corrections?.register ?? { consistent: true },
        other: result.corrections?.other ?? [],
      },
      translations: result.translations ?? {},
    }))
    .catch((error) => {
      log.warn("feedback fetch failed", error);
      return { corrections: EMPTY_CORRECTIONS, translations: {} };
    });

  return {
    fullText,
    feedback,
  };
}
