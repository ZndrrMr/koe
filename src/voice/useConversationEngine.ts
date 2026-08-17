import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState, Linking } from "react-native";
import { randomUUID } from "expo-crypto";

import { AudioContractError } from "../services/audioContract";
import {
  streamConversation,
  ProviderStreamError,
  ProviderTimeoutError,
} from "../services/llm";
import { analyzePronunciation } from "../services/pitch";
import { annotate } from "../services/furigana";
import {
  RecordedAudioInputError,
  transcribeRecordedAudio,
} from "../services/recordedAudioInput";
import { startStreaming, STTError } from "../services/stt";
import {
  AudioPlaybackError,
  PCMPlaybackQueue,
  play,
  saveAudioFromBase64,
  stop,
  synthesize,
} from "../services/tts";
import { useSession } from "../stores/useSession";
import { fail, success, tap } from "../utils/haptics";
import { log } from "../utils/log";
import { errorName, voiceEvent } from "../utils/telemetry";
import { shouldAutoSendFirstTranscript } from "./firstExchange";
import {
  ConversationEngine,
  NoPlayableAudioError,
  type ConversationDependencies,
  type ConversationFailure,
  type ConversationSessionSnapshot,
} from "./conversationEngine";

function classifyError(error: unknown): ConversationFailure {
  if (error instanceof STTError) {
    switch (error.kind) {
      case "permission-denied":
        return "permissionDenied";
      case "network":
        return "network";
      case "no-speech":
        return "noSpeech";
      case "interrupted":
        return "audioInterruption";
      case "cancelled":
        return "cancelled";
      default:
        return "sttFailure";
    }
  }
  if (error instanceof ProviderTimeoutError) return "providerTimeout";
  if (error instanceof ProviderStreamError) return "providerFailure";
  if (error instanceof AudioContractError) return "audioContract";
  if (error instanceof AudioPlaybackError)
    return error.kind === "interrupted"
      ? "audioInterruption"
      : "playbackFailure";
  if (error instanceof NoPlayableAudioError) return "playbackFailure";
  if (error instanceof RecordedAudioInputError) {
    return error.kind === "network" || error.kind === "provider"
      ? "network"
      : "sttFailure";
  }
  if (error instanceof Error && error.name === "AbortError") return "cancelled";
  return "network";
}

function sessionSnapshot(): ConversationSessionSnapshot {
  const state = useSession.getState();
  return {
    id: state.id,
    turns: state.turns,
    isRecording: state.isRecording,
    isStreaming: state.isStreaming,
    voice: state.voice,
    latency: state.latency,
    traceContext: state.traceContext,
    closeout: state.closeout,
  };
}

function createDependencies(): ConversationDependencies {
  return {
    speechInput: {
      start: async ({ onEvent, onAudioEnergy, trace }) =>
        startStreaming({
          languageHint: "ja,en",
          trace,
          onAudioEnergy,
          onSpeechStart: () => onEvent({ type: "speechStart" }),
          onSpeechEnd: () => onEvent({ type: "speechEnd" }),
          onRecognitionEnd: () => onEvent({ type: "endpoint" }),
          onError: (error) => onEvent({ type: "failure", error }),
          onChunk: (chunk) =>
            onEvent({
              type: chunk.isFinal ? "final" : "interim",
              text: chunk.text,
              confidence: chunk.confidence,
            }),
        }),
    },
    recordedSpeechInput: __DEV__
      ? {
          transcribe: (input, trace) => transcribeRecordedAudio(input, trace),
        }
      : undefined,
    replyStream: streamConversation,
    audio: {
      createQueue: (options) => new PCMPlaybackQueue(options),
      save: saveAudioFromBase64,
      synthesize,
      play,
      stop,
    },
    pronunciation: {
      analyze: async ({ targetText, attemptAudioUri, previous }) => {
        const targetReading = (await annotate(targetText))
          .map((run) => run.reading ?? run.base)
          .join("");
        const referenceAudioUri =
          previous?.referenceAudioUri ??
          (
            await synthesize(targetText, {
              withTimestamps: true,
            })
          ).audioUri;
        const pronunciation = await analyzePronunciation({
          targetText,
          targetReading,
          referenceAudioUri,
          attemptAudioUri,
          previous: previous?.pronunciation
            ? { attemptId: previous.id, feedback: previous.pronunciation }
            : undefined,
        });
        return { referenceAudioUri, pronunciation };
      },
    },
    session: {
      snapshot: sessionSnapshot,
      start: (sessionId) => useSession.getState().start(sessionId),
      addTurn: (turn) => useSession.getState().addTurn(turn),
      patchTurn: (turnId, patch) =>
        useSession.getState().patchTurn(turnId, patch),
      appendAssistantText: (turnId, chunk) =>
        useSession.getState().appendAssistantText(turnId, chunk),
      setRecording: (recording) =>
        useSession.getState().setRecording(recording),
      setStreaming: (streaming) =>
        useSession.getState().setStreaming(streaming),
      setVoice: (voice) => useSession.getState().setVoice(voice),
      setVoicePhase: (phase, patch) =>
        useSession.getState().setVoicePhase(phase, patch),
      setInterimTranscript: (text) =>
        useSession.getState().setInterimTranscript(text),
      setLatency: (latency) => useSession.getState().setLatency(latency),
      setTraceContext: (trace) => useSession.getState().setTraceContext(trace),
      prepareCloseout: () => useSession.getState().prepareCloseout(),
      end: () => useSession.getState().end(),
    },
    clock: {
      now: () => Date.now(),
      setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimer: (handle) =>
        clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    ids: { next: randomUUID },
    telemetry: voiceEvent,
    logger: log,
    classifyError,
    errorName,
    haptics: { tap, success, fail },
    openSettings: () => Linking.openSettings(),
    shouldAutoSend: shouldAutoSendFirstTranscript,
  };
}

export function useConversationEngine(sessionId: string, intro?: string) {
  const engine = useMemo(
    () => new ConversationEngine(sessionId, intro, createDependencies()),
    [intro, sessionId],
  );
  const state = useSyncExternalStore(
    engine.subscribe,
    engine.getState,
    engine.getState,
  );

  useEffect(() => {
    void engine.start().catch((error) => {
      log.warn("Could not start conversation engine", error);
    });
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      const wasInactive = previous !== "active";
      const isInactive = next !== "active";
      previous = next;
      if (isInactive && !wasInactive) {
        void engine.interrupt("app");
      } else if (next === "active" && wasInactive) {
        void engine.resume();
      }
    });
    return () => {
      subscription.remove();
      engine.dispose();
    };
  }, [engine]);

  return { engine, state };
}
