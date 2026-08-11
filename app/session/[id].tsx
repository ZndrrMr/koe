import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  MessageCircleMore,
  RotateCcw,
  Send,
  Settings,
  Volume2,
  X,
} from "lucide-react-native";
import { randomUUID } from "expo-crypto";

import { getScenario } from "@/data/scenarios";
import { useSession, type ChatTurn } from "@/stores/useSession";
import { useSettings } from "@/stores/useSettings";
import { useProgress } from "@/stores/useProgress";
import { startStreaming, STTError } from "@/services/stt";
import {
  ProviderTimeoutError,
  streamConversation,
  generateSuggestedReplies,
} from "@/services/llm";
import {
  PCMPlaybackQueue,
  synthesize,
  play,
  stop as stopSpeech,
} from "@/services/tts";
import { annotate } from "@/services/furigana";
import { MicButton } from "@/components/MicButton";
import { SuggestedReplyChips } from "@/components/SuggestedReplyChips";
import { JapaneseText } from "@/components/JapaneseText";
import { tap, fail as failHaptic, success } from "@/utils/haptics";
import { log } from "@/utils/log";
import { colors } from "@/theme/colors";
import {
  VoiceLatencyTracker,
  VOICE_PHASE_COPY,
  voiceError,
  type VoiceLatency,
  type VoiceLifecycle,
} from "@/voice/lifecycle";
import { ResponseRunController } from "@/voice/responseRun";

type FailedReply = { text: string; audioUri?: string; assistantTurnId: string };

export default function SessionScreen() {
  const router = useRouter();
  const { id, scenario: scenarioId } = useLocalSearchParams<{
    id: string;
    scenario?: string;
  }>();
  const scenario = getScenario(scenarioId ?? "");
  const settings = useSettings();
  const bumpXp = useProgress((state) => state.bumpXp);
  const tickDay = useProgress((state) => state.tickDay);
  const session = useSession();

  const [suggested, setSuggested] = useState<
    Array<{ ja: string; en: string; hint: string }>
  >([]);
  const [showPhraseHelp, setShowPhraseHelp] = useState(false);
  const [draftTranscript, setDraftTranscript] = useState("");
  const [draftAudioUri, setDraftAudioUri] = useState<string | undefined>();
  const [furiganaCache, setFuriganaCache] = useState<
    Record<string, Awaited<ReturnType<typeof annotate>>>
  >({});

  const sttHandleRef = useRef<Awaited<
    ReturnType<typeof startStreaming>
  > | null>(null);
  const pressStartRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const responseRunsRef = useRef(new ResponseRunController());
  const failedReplyRef = useRef<FailedReply | null>(null);
  const latencyTrackerRef = useRef(new VoiceLatencyTracker());

  useEffect(() => {
    if (!id || useSession.getState().id === id) return;
    useSession.getState().start(
      id,
      scenario
        ? {
            scenarioId: scenario.id,
            topic: scenario.description,
            registerTarget: scenario.registerTarget,
            jlptTarget: scenario.difficulty,
          }
        : {},
    );
  }, [id, scenario?.id]);

  useEffect(
    () => () => {
      responseRunsRef.current.interrupt();
      void sttHandleRef.current?.cancel();
      void stopSpeech();
    },
    [],
  );

  const updateLatency = useCallback(
    (latency: VoiceLatency, stage: keyof VoiceLatency) => {
      useSession.getState().setLatency(latency);
      log.info("voice_latency", {
        sessionId: id,
        stage,
        valueMs: latency[stage],
        ...latency,
      });
    },
    [id],
  );

  const annotateTurn = useCallback(async (turn: ChatTurn) => {
    const runs = await annotate(turn.textJa);
    setFuriganaCache((previous) => ({ ...previous, [turn.id]: runs }));
  }, []);

  const playAssistant = useCallback(
    async (turn: ChatTurn) => {
      try {
        if (turn.audioUri) {
          await play(turn.audioUri);
          return;
        }
        if (!turn.textJa.trim()) return;
        const result = await synthesize(turn.textJa, { voice: settings.voice });
        await play(result.audioUri);
      } catch (error) {
        log.warn("TTS replay failed", error);
        useSession.getState().setVoice(voiceError("playbackFailure"));
      }
    },
    [settings.voice],
  );

  const refreshSuggestions = useCallback(
    async (history: Array<{ role: "user" | "assistant"; content: string }>) => {
      const output = await generateSuggestedReplies({
        history,
        registerTarget: scenario?.registerTarget,
        jlptTarget: scenario?.difficulty,
      });
      setSuggested(output);
    },
    [scenario],
  );

  const sendUser = useCallback(
    async (text: string, audioUri?: string, retryAssistantTurnId?: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        useSession.getState().setVoice(voiceError("silence"));
        return;
      }

      const interruptedTurnId = responseRunsRef.current.interrupt();
      if (interruptedTurnId && interruptedTurnId !== retryAssistantTurnId) {
        useSession
          .getState()
          .patchTurn(interruptedTurnId, {
            streaming: false,
            interrupted: true,
          });
      }
      await stopSpeech();

      const assistantTurnId = retryAssistantTurnId ?? randomUUID();
      if (retryAssistantTurnId) {
        useSession.getState().patchTurn(assistantTurnId, {
          textJa: "",
          streaming: true,
          interrupted: false,
          corrections: undefined,
        });
      } else {
        const userTurn: ChatTurn = {
          id: randomUUID(),
          role: "user",
          textJa: trimmed,
          audioUri,
          createdAt: Date.now(),
        };
        const assistantTurn: ChatTurn = {
          id: assistantTurnId,
          role: "assistant",
          textJa: "",
          streaming: true,
          createdAt: Date.now(),
        };
        useSession.getState().addTurn(userTurn);
        useSession.getState().addTurn(assistantTurn);
        void annotateTurn(userTurn);
        success();
      }

      const historyWithUser = useSession
        .getState()
        .turns.filter((turn) => turn.id !== assistantTurnId && turn.textJa)
        .map((turn) => ({ role: turn.role, content: turn.textJa }));
      const responseRun = responseRunsRef.current.start(assistantTurnId);
      failedReplyRef.current = null;
      useSession.getState().setStreaming(true);
      useSession
        .getState()
        .setVoicePhase(retryAssistantTurnId ? "retry" : "understanding", {
          interimTranscript: "",
        });
      latencyTrackerRef.current.transcriptCommitted();

      let receivedText = false;
      let receivedAudio = false;
      let playbackFailed = false;
      let reply = "";
      const handlePlaybackFailure = (error: Error) => {
        if (playbackFailed) return;
        playbackFailed = true;
        log.warn("response playback failed", error);
        failedReplyRef.current = { text: trimmed, audioUri, assistantTurnId };
        responseRunsRef.current.interrupt();
        useSession.getState().setVoice(voiceError("playbackFailure"));
      };
      const audioQueue = new PCMPlaybackQueue({
        onStarted: () => {
          if (!responseRunsRef.current.isCurrent(assistantTurnId)) return;
          const latency = latencyTrackerRef.current.firstAudioPlayed();
          updateLatency(latency, "firstTextToFirstAudioMs");
          useSession.getState().setVoicePhase("speaking");
        },
        onFinished: () => {
          if (!responseRunsRef.current.complete(assistantTurnId)) return;
          useSession.getState().setVoicePhase("idle");
        },
        onError: handlePlaybackFailure,
      });

      try {
        const generator = streamConversation({
          context: useSession.getState().context,
          history: historyWithUser.slice(0, -1),
          userTurn: trimmed,
          voice: settings.voice,
          signal: responseRun.signal,
        });
        while (true) {
          const next = await generator.next();
          if (next.done) {
            const result = next.value;
            const finalText = result.fullText || reply;
            useSession.getState().patchTurn(assistantTurnId, {
              textJa: finalText,
              streaming: false,
            });
            void result.feedback.then((corrections) => {
              useSession
                .getState()
                .patchTurn(assistantTurnId, { corrections });
            });
            failedReplyRef.current = null;
            bumpXp(10);
            tickDay();
            void annotateTurn({
              id: assistantTurnId,
              role: "assistant",
              textJa: finalText,
              createdAt: Date.now(),
            });
            if (showPhraseHelp) {
              void refreshSuggestions([
                ...historyWithUser,
                { role: "assistant", content: finalText },
              ]);
            }

            if (receivedAudio) {
              void audioQueue.finish().catch((error) => {
                handlePlaybackFailure(
                  error instanceof Error
                    ? error
                    : new Error("Streaming playback did not finish"),
                );
              });
            } else {
              await audioQueue.stop();
              if (finalText) {
                const synthesized = await synthesize(finalText, {
                  voice: settings.voice,
                });
                useSession
                  .getState()
                  .patchTurn(assistantTurnId, {
                    audioUri: synthesized.audioUri,
                  });
                if (synthesized.durationMs > 0) {
                  await play(synthesized.audioUri, {
                    onStarted: () => {
                      if (!responseRunsRef.current.isCurrent(assistantTurnId))
                        return;
                      const latency =
                        latencyTrackerRef.current.firstAudioPlayed();
                      updateLatency(latency, "firstTextToFirstAudioMs");
                      useSession.getState().setVoicePhase("speaking");
                    },
                    onFinished: () => {
                      if (!responseRunsRef.current.complete(assistantTurnId))
                        return;
                      useSession.getState().setVoicePhase("idle");
                    },
                    onError: handlePlaybackFailure,
                  });
                } else {
                  responseRunsRef.current.complete(assistantTurnId);
                  useSession.getState().setVoicePhase("idle");
                }
              } else {
                responseRunsRef.current.complete(assistantTurnId);
                useSession.getState().setVoicePhase("idle");
              }
            }
            break;
          }

          const chunk = next.value;
          if (chunk.type === "text") {
            reply += chunk.text;
            useSession
              .getState()
              .appendAssistantText(assistantTurnId, chunk.text);
            if (!receivedText) {
              receivedText = true;
              const latency = latencyTrackerRef.current.firstTextReceived();
              updateLatency(latency, "transcriptToFirstTextMs");
              useSession.getState().setVoicePhase("firstReply");
            }
          } else {
            receivedAudio = true;
            try {
              await audioQueue.enqueue(
                chunk.audioBase64,
                chunk.sampleRate,
                chunk.channels,
              );
            } catch (error) {
              handlePlaybackFailure(
                error instanceof Error
                  ? error
                  : new Error("Could not queue streamed audio"),
              );
              throw error;
            }
          }
        }
      } catch (error) {
        await audioQueue.stop();
        if (
          responseRun.signal.aborted &&
          !(error instanceof ProviderTimeoutError)
        ) {
          useSession.getState().patchTurn(assistantTurnId, {
            streaming: false,
            interrupted: !playbackFailed,
          });
          return;
        }
        log.error("conversation stream failed", error);
        responseRunsRef.current.complete(assistantTurnId);
        failedReplyRef.current = { text: trimmed, audioUri, assistantTurnId };
        useSession.getState().patchTurn(assistantTurnId, {
          textJa: reply || "Koe could not finish that reply.",
          streaming: false,
        });
        useSession
          .getState()
          .setVoice(
            error instanceof ProviderTimeoutError
              ? voiceError("providerTimeout")
              : voiceError("network"),
          );
      } finally {
        if (responseRunsRef.current.isLatest(responseRun.token))
          useSession.getState().setStreaming(false);
      }
    },
    [
      annotateTurn,
      bumpXp,
      refreshSuggestions,
      settings.voice,
      showPhraseHelp,
      tickDay,
      updateLatency,
    ],
  );

  const onPressIn = useCallback(async () => {
    if (useSession.getState().isRecording) return;
    const wasResponding = Boolean(
      responseRunsRef.current.hasActiveRun() ||
        useSession.getState().isStreaming,
    );
    if (wasResponding) {
      useSession.getState().setVoicePhase("interrupted");
      const interruptedTurnId = responseRunsRef.current.interrupt();
      if (interruptedTurnId) {
        useSession
          .getState()
          .patchTurn(interruptedTurnId, {
            streaming: false,
            interrupted: true,
          });
      }
      useSession.getState().setStreaming(false);
      await stopSpeech();
    }

    pressStartRef.current = Date.now();
    latencyTrackerRef.current = new VoiceLatencyTracker();
    latencyTrackerRef.current.listeningStarted();
    useSession.getState().setLatency({});
    setDraftTranscript("");
    setDraftAudioUri(undefined);
    useSession.getState().setRecording(true);
    useSession.getState().setVoicePhase("listening", { interimTranscript: "" });

    try {
      sttHandleRef.current = await startStreaming({
        languageHint: "ja,en",
        onChunk: (chunk) => {
          const previous =
            useSession.getState().latency.listeningToTranscriptMs;
          const latency = latencyTrackerRef.current.transcriptReceived();
          if (previous === undefined)
            updateLatency(latency, "listeningToTranscriptMs");
          setDraftTranscript(chunk.text);
          useSession.getState().setInterimTranscript(chunk.text);
        },
      });
    } catch (error) {
      log.error("start STT failed", error);
      failHaptic();
      useSession.getState().setRecording(false);
      if (error instanceof STTError && error.kind === "permission-denied") {
        useSession.getState().setVoice(voiceError("permissionDenied"));
      } else if (error instanceof STTError && error.kind === "interrupted") {
        useSession.getState().setVoice(voiceError("audioInterruption"));
      } else {
        useSession.getState().setVoice(voiceError("sttFailure"));
      }
    }
  }, [updateLatency]);

  const onPressOut = useCallback(async () => {
    if (!useSession.getState().isRecording) return;
    const duration = Date.now() - pressStartRef.current;
    useSession.getState().setRecording(false);
    const handle = sttHandleRef.current;
    sttHandleRef.current = null;
    if (!handle) return;

    try {
      if (duration < 400) {
        await handle.cancel();
        useSession.getState().setVoicePhase("idle", { interimTranscript: "" });
        return;
      }
      const result = await handle.stop();
      if (!result.fullText.trim()) {
        useSession.getState().setVoice(voiceError("silence"));
        return;
      }
      setDraftTranscript(result.fullText);
      setDraftAudioUri(result.audioUri || undefined);
      useSession
        .getState()
        .setVoicePhase("correction", { interimTranscript: result.fullText });
    } catch (error) {
      log.error("finish STT failed", error);
      if (error instanceof STTError && error.kind === "network") {
        useSession.getState().setVoice(voiceError("network"));
      } else if (error instanceof STTError && error.kind === "interrupted") {
        useSession.getState().setVoice(voiceError("audioInterruption"));
      } else if (
        error instanceof STTError &&
        error.kind === "permission-denied"
      ) {
        useSession.getState().setVoice(voiceError("permissionDenied"));
      } else if (error instanceof STTError && error.kind === "no-speech") {
        useSession.getState().setVoice(voiceError("silence"));
      } else {
        useSession.getState().setVoice(voiceError("sttFailure"));
      }
    }
  }, []);

  const submitTranscript = useCallback(() => {
    const text = draftTranscript.trim();
    if (!text) {
      useSession.getState().setVoice(voiceError("silence"));
      return;
    }
    setDraftTranscript("");
    useSession
      .getState()
      .setVoicePhase("understanding", { interimTranscript: "" });
    void sendUser(text, draftAudioUri);
  }, [draftAudioUri, draftTranscript, sendUser]);

  const recoverVoice = useCallback(() => {
    const recovery = useSession.getState().voice.recovery;
    if (recovery === "openSettings") {
      void Linking.openSettings();
      return;
    }
    if (recovery === "retryResponse" && failedReplyRef.current) {
      const failed = failedReplyRef.current;
      useSession.getState().setVoicePhase("retry");
      void sendUser(failed.text, failed.audioUri, failed.assistantTurnId);
      return;
    }
    useSession.getState().setVoicePhase("idle", { interimTranscript: "" });
  }, [sendUser]);

  const discardTranscript = useCallback(() => {
    setDraftTranscript("");
    setDraftAudioUri(undefined);
    useSession.getState().setVoicePhase("idle", { interimTranscript: "" });
  }, []);

  const endSession = () => {
    Alert.alert("End session", "Finish this conversation?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "End",
        style: "destructive",
        onPress: () => {
          responseRunsRef.current.interrupt();
          void sttHandleRef.current?.cancel();
          void stopSpeech();
          useSession.getState().end();
          router.back();
        },
      },
    ]);
  };

  const togglePhraseHelp = () => {
    tap();
    const next = !showPhraseHelp;
    setShowPhraseHelp(next);
    if (next && !suggested.length) {
      const history = useSession
        .getState()
        .turns.filter((turn) => turn.textJa)
        .map((turn) => ({ role: turn.role, content: turn.textJa }));
      void refreshSuggestions(history);
    }
  };

  const canInterrupt = ["understanding", "firstReply", "speaking"].includes(
    session.voice.phase,
  );

  return (
    <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark">
      <View className="flex-row items-center justify-between border-b border-black/5 px-4 py-3 dark:border-white/5">
        <Pressable
          accessibilityRole="button"
          onPress={endSession}
          className="min-h-11 min-w-11 flex-row items-center gap-1"
        >
          <X color={colors.muted} size={22} />
          <Text className="text-muted">End</Text>
        </Pressable>
        <View className="items-center">
          <Text className="font-semibold text-fg dark:text-fg-dark">
            {scenario?.title ?? "Conversation"}
          </Text>
          {scenario && (
            <Text className="mt-0.5 text-[10px] text-muted">
              Optional topic
            </Text>
          )}
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        ref={scrollRef}
        className="flex-1 px-3"
        contentContainerClassName="py-4"
        contentContainerStyle={{ flexGrow: 1 }}
        onContentSizeChange={() =>
          scrollRef.current?.scrollToEnd({ animated: true })
        }
      >
        {!session.turns.length && (
          <View className="flex-1 items-center justify-center px-8 py-20">
            <Text className="text-center font-jpBold text-2xl text-fg dark:text-fg-dark">
              何でも話してみてください
            </Text>
            <Text className="mt-3 text-center leading-5 text-muted">
              Hold the mic and speak in Japanese. Ask for help, translation,
              correction, or roleplay whenever you want it.
            </Text>
          </View>
        )}
        {session.turns.map((turn) => (
          <TurnBubble
            key={turn.id}
            turn={turn}
            runs={furiganaCache[turn.id] ?? [{ base: turn.textJa }]}
            onReplay={() => playAssistant(turn)}
          />
        ))}
      </ScrollView>

      <VoiceLifecyclePanel
        voice={session.voice}
        latency={session.latency}
        draftTranscript={draftTranscript}
        onChangeTranscript={setDraftTranscript}
        onSubmit={submitTranscript}
        onDiscard={discardTranscript}
        onRecover={recoverVoice}
      />

      {showPhraseHelp && (
        <View className="mx-4 mb-2 rounded-2xl bg-accent/10 px-3 py-3">
          <Text className="mb-2 text-xs font-semibold text-accent">
            Try one of these
          </Text>
          <SuggestedReplyChips
            replies={suggested}
            onPick={(reply) => void sendUser(reply.ja)}
          />
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showPhraseHelp }}
        onPress={togglePhraseHelp}
        className="min-h-11 flex-row items-center gap-2 px-4 py-2"
      >
        <MessageCircleMore color={colors.accent} size={17} />
        <Text className="text-xs font-semibold text-accent">
          {showPhraseHelp ? "Hide phrase help" : "Need a phrase?"}
        </Text>
      </Pressable>

      <View className="border-t border-black/5 dark:border-white/5">
        <MicButton
          recording={session.isRecording}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          prompt={canInterrupt ? "Hold to interrupt" : undefined}
        />
      </View>
    </SafeAreaView>
  );
}

function VoiceLifecyclePanel({
  voice,
  latency,
  draftTranscript,
  onChangeTranscript,
  onSubmit,
  onDiscard,
  onRecover,
}: {
  voice: VoiceLifecycle;
  latency: VoiceLatency;
  draftTranscript: string;
  onChangeTranscript: (value: string) => void;
  onSubmit: () => void;
  onDiscard: () => void;
  onRecover: () => void;
}) {
  const copy = VOICE_PHASE_COPY[voice.phase];
  const recoveryLabel =
    voice.recovery === "openSettings"
      ? "Open settings"
      : voice.recovery === "retryResponse"
        ? "Retry response"
        : voice.recovery === "resume"
          ? "Resume"
          : "Try again";

  return (
    <View className="mx-4 mb-2 rounded-2xl bg-surface px-4 py-3 dark:bg-surface-dark">
      <View accessibilityLiveRegion="polite" accessibilityRole="summary">
        <Text className="text-sm font-semibold text-fg dark:text-fg-dark">
          {copy.title}
        </Text>
        <Text className="mt-0.5 text-xs text-muted">
          {voice.message ?? copy.detail}
        </Text>
      </View>

      {voice.phase === "interimTranscript" && voice.interimTranscript ? (
        <Text className="mt-2 font-jp text-base text-fg dark:text-fg-dark">
          {voice.interimTranscript}
        </Text>
      ) : null}

      {voice.phase === "correction" ? (
        <View className="mt-3">
          <TextInput
            accessibilityLabel="Correct transcript"
            value={draftTranscript}
            onChangeText={onChangeTranscript}
            multiline
            className="min-h-11 rounded-xl bg-bg px-3 py-2 font-jp text-base text-fg dark:bg-bg-dark dark:text-fg-dark"
          />
          <View className="mt-2 flex-row gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Try recording again"
              onPress={onDiscard}
              className="min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-black/5 px-3 dark:bg-white/10"
            >
              <RotateCcw color={colors.muted} size={16} />
              <Text className="font-semibold text-muted">Try again</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send corrected transcript"
              onPress={onSubmit}
              className="min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-accent px-3"
            >
              <Send color="white" size={16} />
              <Text className="font-semibold text-white">Send</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {voice.phase === "recoverableError" ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRecover}
          className="mt-3 min-h-11 flex-row items-center justify-center gap-2 rounded-xl bg-accent px-4"
        >
          {voice.recovery === "openSettings" ? (
            <Settings color="white" size={16} />
          ) : (
            <RotateCcw color="white" size={16} />
          )}
          <Text className="font-semibold text-white">{recoveryLabel}</Text>
        </Pressable>
      ) : null}

      {Object.values(latency).some((value) => value !== undefined) ? (
        <Text className="mt-2 text-[10px] text-muted">
          Transcript {formatLatency(latency.listeningToTranscriptMs)} · First
          words {formatLatency(latency.transcriptToFirstTextMs)} · Audio{" "}
          {formatLatency(latency.firstTextToFirstAudioMs)}
        </Text>
      ) : null}
    </View>
  );
}

function formatLatency(value?: number): string {
  return value === undefined ? "—" : `${Math.round(value)} ms`;
}

function TurnBubble({
  turn,
  runs,
  onReplay,
}: {
  turn: ChatTurn;
  runs: Awaited<ReturnType<typeof annotate>>;
  onReplay: () => void;
}) {
  const isUser = turn.role === "user";
  const correctionNotes = turn.corrections
    ? [
        ...turn.corrections.particles.map(
          (item) =>
            `${item.original} → ${item.corrected} — ${item.explanation}`,
        ),
        ...turn.corrections.other.map(
          (item) =>
            `${item.original} → ${item.corrected} — ${item.explanation}`,
        ),
        ...(!turn.corrections.register.consistent &&
        turn.corrections.register.note
          ? [turn.corrections.register.note]
          : []),
      ]
    : [];

  return (
    <View
      className={`my-2 max-w-[85%] ${isUser ? "self-end items-end" : "self-start items-start"}`}
    >
      <View
        className={`rounded-2xl px-4 py-3 ${isUser ? "bg-primary" : "bg-surface dark:bg-surface-dark"}`}
      >
        {turn.textJa ? (
          <JapaneseText
            runs={runs}
            color={isUser ? "#fff" : undefined}
            fontSize={18}
          />
        ) : (
          <Text className="text-sm text-muted">
            {turn.streaming ? "Koe is thinking…" : "No reply"}
          </Text>
        )}
        {turn.textEn && (
          <Text
            className={`mt-2 text-xs ${isUser ? "text-white/70" : "text-muted"}`}
          >
            {turn.textEn}
          </Text>
        )}
        {!isUser && turn.textJa ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Replay response"
            onPress={onReplay}
            className="-mb-2 mt-1 min-h-11 flex-row items-center gap-1"
          >
            <Volume2 color={colors.accent} size={14} />
            <Text className="text-xs text-accent">Replay</Text>
          </Pressable>
        ) : null}
      </View>
      {turn.interrupted ? (
        <Text className="mt-1 text-[10px] text-muted">Interrupted</Text>
      ) : null}
      {!isUser && correctionNotes.length > 0 && (
        <View className="mt-1 max-w-full rounded-xl bg-warning/10 px-3 py-2">
          <Text className="text-[10px] font-bold uppercase text-warning">
            Quick note
          </Text>
          {correctionNotes.map((note, index) => (
            <Text
              key={index}
              className="mt-1 text-xs text-fg dark:text-fg-dark"
            >
              {note}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
