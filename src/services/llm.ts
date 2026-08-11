import { postJson, postStream } from "@/services/api";
import { tutorSystemPrompt } from "@/prompts/tutor";
import type { Register, JlptLevel } from "@/data/scenarios";
import type { ConversationContext } from "@/stores/useSession";
import { hasWorker } from "@/utils/config";
import { log } from "@/utils/log";
import { extractSSEEvents } from "@/services/sse";

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
      sampleRate: number;
      channels: number;
    };

export class ProviderTimeoutError extends Error {
  constructor(message = "The conversation provider timed out") {
    super(message);
    this.name = "ProviderTimeoutError";
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
  context?: ConversationContext;
  history: ConvoTurn[];
  userTurn: string;
  voice?: "ja-female-1" | "ja-female-2" | "ja-male-1";
  signal?: AbortSignal;
}): AsyncGenerator<ConversationChunk, ConversationResult, void> {
  const system = tutorSystemPrompt({
    topic: opts.context?.topic,
    registerTarget: opts.context?.registerTarget,
    jlptTarget: opts.context?.jlptTarget,
  });

  if (!hasWorker()) {
    log.warn("LLM: worker unset, yielding stub reply.");
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
    maxTokens: 300,
    voice: opts.voice,
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
  try {
    armTimeout();
    const response = await postStream("/llm/chat", chatBody, {
      signal: controller.signal,
    });
    if (!response.body)
      throw new Error("Streaming response body is unavailable");

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
        if (payload === "[DONE]") {
          doneByProvider = true;
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
          log.warn("Ignoring malformed conversation SSE event");
          continue;
        }
        const delta = event.choices?.[0]?.delta;
        const text = delta?.audio?.transcript ?? delta?.content ?? "";
        if (text) {
          fullText += text;
          yield { type: "text", text };
        }
        if (delta?.audio?.data) {
          yield {
            type: "audio",
            audioBase64: delta.audio.data,
            sampleRate: 48_000,
            channels: 1,
          };
        }
      }
      if (next.done) break;
    }
  } catch (error) {
    if (timedOut) throw new ProviderTimeoutError();
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    opts.signal?.removeEventListener("abort", abortFromCaller);
  }

  fullText = fullText.trim();

  const feedback = postJson<{
    corrections?: ConversationCorrections;
    translations?: { user?: string; tutor?: string };
  }>(
    "/llm/flash",
    {
      task: "feedback",
      registerTarget: opts.context?.registerTarget,
      jlptTarget: opts.context?.jlptTarget,
      history: opts.history,
      userTurn: opts.userTurn,
      tutorReply: fullText,
    },
    { signal: opts.signal },
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

export async function generateSuggestedReplies(opts: {
  history: ConvoTurn[];
  registerTarget?: Register;
  jlptTarget?: JlptLevel;
}): Promise<Array<{ ja: string; en: string; hint: string }>> {
  if (!hasWorker()) {
    return [
      {
        ja: "今日はいい天気ですね。",
        en: "Nice weather today.",
        hint: "Start with the day.",
      },
      {
        ja: "最近、どうですか？",
        en: "How have you been?",
        hint: "Ask an open question.",
      },
      {
        ja: "もう一度お願いします。",
        en: "One more time, please.",
        hint: "Ask for repetition.",
      },
    ];
  }

  try {
    const res = await postJson<{
      replies: Array<{ ja: string; en: string; hint: string }>;
    }>("/llm/flash", {
      task: "suggest-replies",
      history: opts.history,
      registerTarget: opts.registerTarget,
      jlptTarget: opts.jlptTarget,
    });
    return res.replies ?? [];
  } catch (e) {
    log.warn("generateSuggestedReplies failed", e);
    return [];
  }
}
