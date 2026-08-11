import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Linking,
  Modal,
  Pressable,
  StyleSheet,
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
import { MicButton } from "@/components/MicButton";
import { SuggestedReplyChips } from "@/components/SuggestedReplyChips";
import { AcousticVoiceForm } from "@/components/AcousticVoiceForm";
import { tap, fail as failHaptic, success } from "@/utils/haptics";
import { log } from "@/utils/log";
import {
  type ConversationPalette,
  useConversationPalette,
} from "@/theme/conversation";
import { CONVERSATION_TARGET } from "@/theme/interaction";
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
  const palette = useConversationPalette();
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
  const [audioEnergy, setAudioEnergy] = useState(0);
  const [showCoda, setShowCoda] = useState(false);
  const [dismissedCorrectionId, setDismissedCorrectionId] = useState<
    string | null
  >(null);
  const sttHandleRef = useRef<Awaited<
    ReturnType<typeof startStreaming>
  > | null>(null);
  const pressStartRef = useRef(0);
  const responseRunsRef = useRef(new ResponseRunController());
  const failedReplyRef = useRef<FailedReply | null>(null);
  const latencyTrackerRef = useRef(new VoiceLatencyTracker());
  const voiceSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    if (!id || useSession.getState().id === id) return;
    const store = useSession.getState();
    store.start(
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
    if (__DEV__) {
      const reviewPhase = process.env.EXPO_PUBLIC_KOE_REVIEW_PHASE as
        | VoiceLifecycle["phase"]
        | undefined;
      if (reviewPhase && reviewPhase in VOICE_PHASE_COPY) {
        store.setVoicePhase(reviewPhase);
        if (reviewPhase === "correction") {
          setDraftTranscript("明日は友達と京都へ行きます。");
        }
        if (reviewPhase === "listening" || reviewPhase === "speaking") {
          setAudioEnergy(0.62);
        }
      }
      if (process.env.EXPO_PUBLIC_KOE_REVIEW_CODA === "1") {
        store.addTurn({
          id: "review-user-1",
          role: "user",
          textJa: "明日は友達と京都に行きます。",
          createdAt: Date.now() - 2_000,
        });
        store.addTurn({
          id: "review-assistant-1",
          role: "assistant",
          textJa: "いいですね。京都では何を見たいですか？",
          createdAt: Date.now() - 1_000,
          corrections: {
            particles: [
              {
                original: "京都に行きます",
                corrected: "京都へ行きます",
                explanation: "へ emphasizes the direction of travel.",
              },
            ],
            register: { consistent: true },
            other: [],
          },
        });
        setShowCoda(true);
      }
    }
  }, [id, scenario?.id]);

  useEffect(
    () => () => {
      responseRunsRef.current.interrupt();
      void sttHandleRef.current?.cancel();
      void stopSpeech();
      if (voiceSettleTimerRef.current)
        clearTimeout(voiceSettleTimerRef.current);
    },
    [],
  );

  const settleReply = useCallback((successfulRetry: boolean) => {
    setAudioEnergy(0);
    if (!successfulRetry) {
      useSession.getState().setVoicePhase("idle");
      return;
    }
    useSession.getState().setVoicePhase("success");
    success();
    if (voiceSettleTimerRef.current) clearTimeout(voiceSettleTimerRef.current);
    voiceSettleTimerRef.current = setTimeout(() => {
      if (useSession.getState().voice.phase === "success")
        useSession.getState().setVoicePhase("idle");
    }, 1_400);
  }, []);

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

  const playAssistant = useCallback(
    async (turn: ChatTurn) => {
      try {
        setAudioEnergy(0);
        useSession.getState().setVoicePhase("speaking");
        const playbackCallbacks = {
          onFinished: () => settleReply(false),
          onError: () => {
            setAudioEnergy(0);
            useSession.getState().setVoice(voiceError("playbackFailure"));
          },
        };
        if (turn.audioUri) {
          await play(turn.audioUri, playbackCallbacks);
          return;
        }
        if (!turn.textJa.trim()) return;
        const result = await synthesize(turn.textJa, { voice: settings.voice });
        await play(result.audioUri, playbackCallbacks);
      } catch (error) {
        log.warn("TTS replay failed", error);
        setAudioEnergy(0);
        useSession.getState().setVoice(voiceError("playbackFailure"));
      }
    },
    [settings.voice, settleReply],
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
        useSession.getState().patchTurn(interruptedTurnId, {
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
        setAudioEnergy(0);
        failHaptic();
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
          settleReply(Boolean(retryAssistantTurnId));
        },
        onError: handlePlaybackFailure,
        onEnergy: setAudioEnergy,
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
              useSession.getState().patchTurn(assistantTurnId, { corrections });
            });
            failedReplyRef.current = null;
            bumpXp(10);
            tickDay();
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
                useSession.getState().patchTurn(assistantTurnId, {
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
                      settleReply(Boolean(retryAssistantTurnId));
                    },
                    onError: handlePlaybackFailure,
                  });
                } else {
                  responseRunsRef.current.complete(assistantTurnId);
                  settleReply(Boolean(retryAssistantTurnId));
                }
              } else {
                responseRunsRef.current.complete(assistantTurnId);
                settleReply(Boolean(retryAssistantTurnId));
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
      bumpXp,
      refreshSuggestions,
      settings.voice,
      settleReply,
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
        useSession.getState().patchTurn(interruptedTurnId, {
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
    setAudioEnergy(0);
    useSession.getState().setRecording(true);
    useSession.getState().setVoicePhase("listening", { interimTranscript: "" });

    try {
      sttHandleRef.current = await startStreaming({
        languageHint: "ja,en",
        onAudioEnergy: setAudioEnergy,
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
      setAudioEnergy(0);
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
    setAudioEnergy(0);
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
    setAudioEnergy(0);
    useSession.getState().setVoicePhase("idle", { interimTranscript: "" });
  }, []);

  const endSession = () => {
    tap();
    responseRunsRef.current.interrupt();
    void sttHandleRef.current?.cancel();
    void stopSpeech();
    setAudioEnergy(0);
    setShowCoda(true);
  };

  const finishSession = () => {
    setShowCoda(false);
    useSession.getState().end();
    router.back();
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

  const latestTurn = [...session.turns]
    .reverse()
    .find((turn) => Boolean(turn.textJa));
  const latestAssistant = [...session.turns]
    .reverse()
    .find((turn) => turn.role === "assistant" && Boolean(turn.textJa));
  const latestCorrection = [...session.turns]
    .reverse()
    .find(
      (turn) =>
        turn.role === "assistant" &&
        turn.id !== dismissedCorrectionId &&
        correctionNotesForTurn(turn).length > 0,
    );
  const liveText =
    session.voice.phase === "interimTranscript"
      ? session.voice.interimTranscript
      : session.voice.phase === "correction"
        ? ""
        : (latestTurn?.textJa ?? "");

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: palette.canvas }]}
    >
      <AcousticAtmosphere palette={palette} />

      <View style={styles.header}>
        <Pressable
          testID="end-session"
          accessibilityRole="button"
          accessibilityLabel="End conversation"
          onPress={endSession}
          style={[
            styles.headerPill,
            {
              borderColor: palette.hairline,
              backgroundColor: "transparent",
            },
          ]}
        >
          <X color={palette.ink} size={16} />
          <Text style={[styles.headerAction, { color: palette.ink }]}>End</Text>
        </Pressable>

        <View style={styles.sessionLabel} pointerEvents="none">
          <Text style={[styles.sessionKicker, { color: palette.muted }]}>
            LIVE CONVERSATION
          </Text>
          <Text style={[styles.sessionTitle, { color: palette.ink }]}>
            {scenario?.title ?? "Open conversation"}
          </Text>
        </View>

        <Pressable
          testID="phrase-help"
          accessibilityRole="button"
          accessibilityLabel={
            showPhraseHelp ? "Hide phrase help" : "Show phrase help"
          }
          accessibilityState={{ expanded: showPhraseHelp }}
          onPress={togglePhraseHelp}
          style={[
            styles.headerIcon,
            {
              borderColor: palette.hairline,
              backgroundColor: showPhraseHelp
                ? palette.seamSoft
                : "transparent",
            },
          ]}
        >
          <MessageCircleMore color={palette.ink} size={19} />
        </Pressable>
      </View>

      <View style={styles.stage}>
        <AcousticVoiceForm phase={session.voice.phase} energy={audioEnergy} />
        <CurrentUtterance
          text={liveText}
          isKoe={latestTurn?.role === "assistant"}
          palette={palette}
        />
      </View>

      <VoiceLifecyclePanel
        voice={session.voice}
        latency={session.latency}
        palette={palette}
        draftTranscript={draftTranscript}
        onChangeTranscript={setDraftTranscript}
        onSubmit={submitTranscript}
        onDiscard={discardTranscript}
        onRecover={recoverVoice}
      />

      {showPhraseHelp ? (
        <View
          style={[
            styles.phraseHelp,
            { borderColor: palette.hairline, backgroundColor: palette.canvas },
          ]}
        >
          <Text style={[styles.editorialLabel, { color: palette.seam }]}>
            PHRASE PROMPTS / 任意
          </Text>
          <SuggestedReplyChips
            replies={suggested}
            onPick={(reply) => void sendUser(reply.ja)}
          />
        </View>
      ) : null}

      {latestCorrection && session.voice.phase === "idle" ? (
        <CorrectionMoment
          turn={latestCorrection}
          palette={palette}
          onDismiss={() => setDismissedCorrectionId(latestCorrection.id)}
          onReplay={() => playAssistant(latestAssistant ?? latestCorrection)}
        />
      ) : null}

      <View style={[styles.speakDock, { borderColor: palette.hairline }]}>
        <MicButton
          recording={session.isRecording}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          prompt={canInterrupt ? "Hold to interrupt" : undefined}
          palette={palette}
        />
      </View>

      <SessionCoda
        visible={showCoda}
        turns={session.turns}
        palette={palette}
        onContinue={() => setShowCoda(false)}
        onFinish={finishSession}
      />
    </SafeAreaView>
  );
}

function VoiceLifecyclePanel({
  voice,
  latency,
  palette,
  draftTranscript,
  onChangeTranscript,
  onSubmit,
  onDiscard,
  onRecover,
}: {
  voice: VoiceLifecycle;
  latency: VoiceLatency;
  palette: ConversationPalette;
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
  const isVisible =
    voice.phase === "correction" || voice.phase === "recoverableError";

  return (
    <View>
      <View
        accessible
        accessibilityLiveRegion="polite"
        accessibilityRole="summary"
        style={styles.srStatus}
      >
        <Text>{voice.message ?? `${copy.title}. ${copy.detail}`}</Text>
      </View>

      {isVisible ? (
        <View
          style={[
            styles.lifecyclePanel,
            { borderColor: palette.hairline, backgroundColor: palette.canvas },
          ]}
        >
          {voice.phase === "correction" ? (
            <View>
              <Text style={[styles.editorialLabel, { color: palette.proof }]}>
                TRANSCRIPT / 聞き取り
              </Text>
              <Text style={[styles.panelInstruction, { color: palette.muted }]}>
                Correct only what Koe misheard, then send.
              </Text>
              <TextInput
                accessibilityLabel="Correct transcript"
                value={draftTranscript}
                onChangeText={onChangeTranscript}
                multiline
                selectionColor={palette.proof}
                style={[
                  styles.transcriptInput,
                  { color: palette.ink, borderColor: palette.hairline },
                ]}
              />
              <View style={styles.actionRow}>
                <Pressable
                  testID="discard-transcript"
                  accessibilityRole="button"
                  accessibilityLabel="Try recording again"
                  onPress={onDiscard}
                  style={[
                    styles.secondaryAction,
                    {
                      borderColor: palette.hairline,
                      backgroundColor: "transparent",
                    },
                  ]}
                >
                  <RotateCcw color={palette.ink} size={16} />
                  <Text style={[styles.actionText, { color: palette.ink }]}>
                    Try again
                  </Text>
                </Pressable>
                <Pressable
                  testID="send-transcript"
                  accessibilityRole="button"
                  accessibilityLabel="Send corrected transcript"
                  onPress={onSubmit}
                  style={[
                    styles.primaryAction,
                    {
                      backgroundColor: palette.control,
                    },
                  ]}
                >
                  <Send color={palette.controlText} size={16} />
                  <Text
                    style={[styles.actionText, { color: palette.controlText }]}
                  >
                    Send line
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {voice.phase === "recoverableError" ? (
            <View>
              <Text style={[styles.editorialLabel, { color: palette.proof }]}>
                VOICE PAUSED / 回復
              </Text>
              <Text style={[styles.panelInstruction, { color: palette.ink }]}>
                {voice.message ?? copy.detail}
              </Text>
              <Pressable
                testID="recover-voice"
                accessibilityRole="button"
                accessibilityLabel={recoveryLabel}
                onPress={onRecover}
                style={[
                  styles.recoveryAction,
                  {
                    backgroundColor: palette.control,
                  },
                ]}
              >
                {voice.recovery === "openSettings" ? (
                  <Settings color={palette.controlText} size={16} />
                ) : (
                  <RotateCcw color={palette.controlText} size={16} />
                )}
                <Text
                  style={[styles.actionText, { color: palette.controlText }]}
                >
                  {recoveryLabel}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {Object.values(latency).some((value) => value !== undefined) ? (
        <Text style={[styles.latency, { color: palette.muted }]}>
          HEARD {formatLatency(latency.listeningToTranscriptMs)} · WORDS{" "}
          {formatLatency(latency.transcriptToFirstTextMs)} · VOICE{" "}
          {formatLatency(latency.firstTextToFirstAudioMs)}
        </Text>
      ) : null}
    </View>
  );
}

function CurrentUtterance({
  text,
  isKoe,
  palette,
}: {
  text: string;
  isKoe: boolean;
  palette: ConversationPalette;
}) {
  if (!text) return <View style={styles.utterancePlaceholder} />;
  return (
    <View
      accessible
      accessibilityLabel={`${isKoe ? "Koe" : "You"}: ${text}`}
      style={styles.utterance}
    >
      <Text style={[styles.utteranceRole, { color: palette.muted }]}>
        {isKoe ? "KOE / 応答" : "YOU / 発話"}
      </Text>
      <Text
        numberOfLines={3}
        style={[styles.utteranceText, { color: palette.ink }]}
      >
        {text}
      </Text>
    </View>
  );
}

function CorrectionMoment({
  turn,
  palette,
  onDismiss,
  onReplay,
}: {
  turn: ChatTurn;
  palette: ConversationPalette;
  onDismiss: () => void;
  onReplay: () => void;
}) {
  const note = correctionNotesForTurn(turn)[0];
  if (!note) return null;
  return (
    <View
      accessibilityRole="summary"
      style={[styles.correctionMoment, { borderColor: palette.proof }]}
    >
      <View style={styles.correctionCopy}>
        <Text style={[styles.editorialLabel, { color: palette.proof }]}>
          ONE THING TO KEEP
        </Text>
        <Text style={[styles.correctionText, { color: palette.ink }]}>
          {note}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Replay Koe's line"
        onPress={onReplay}
        style={[styles.inlineIconButton, { borderColor: palette.hairline }]}
      >
        <Volume2 color={palette.ink} size={17} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss correction"
        onPress={onDismiss}
        style={[styles.inlineIconButton, { borderColor: palette.hairline }]}
      >
        <X color={palette.ink} size={17} />
      </Pressable>
    </View>
  );
}

function SessionCoda({
  visible,
  turns,
  palette,
  onContinue,
  onFinish,
}: {
  visible: boolean;
  turns: ChatTurn[];
  palette: ConversationPalette;
  onContinue: () => void;
  onFinish: () => void;
}) {
  const moments = memorableMoments(turns);
  const visibleMoments = moments.length
    ? moments
    : ["The conversation is ready to continue."];
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onContinue}>
      <SafeAreaView
        style={[styles.codaSafeArea, { backgroundColor: palette.canvas }]}
      >
        <View style={styles.codaHeader}>
          <Text style={[styles.sessionKicker, { color: palette.muted }]}>
            SESSION / 余韻
          </Text>
          <Pressable
            testID="continue-conversation"
            accessibilityRole="button"
            accessibilityLabel="Continue conversation"
            onPress={onContinue}
            style={[styles.headerIcon, { borderColor: palette.hairline }]}
          >
            <X color={palette.ink} size={19} />
          </Pressable>
        </View>
        <View style={styles.codaBody}>
          <Text style={[styles.codaTitle, { color: palette.ink }]}>
            今日、残った声
          </Text>
          <Text style={[styles.codaSubtitle, { color: palette.muted }]}>
            A few moments worth carrying forward—not a transcript.
          </Text>
          <View style={styles.momentList}>
            {visibleMoments.map((moment, index) => (
              <View
                key={`${moment}-${index}`}
                style={[styles.momentRow, { borderColor: palette.hairline }]}
              >
                <Text style={[styles.momentNumber, { color: palette.proof }]}>
                  {String(index + 1).padStart(2, "0")}
                </Text>
                <Text style={[styles.momentText, { color: palette.ink }]}>
                  {moment}
                </Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.codaActions}>
          <Pressable
            testID="resume-conversation"
            accessibilityRole="button"
            accessibilityLabel="Keep talking"
            onPress={onContinue}
            style={[
              styles.codaSecondary,
              {
                borderColor: palette.hairline,
                backgroundColor: "transparent",
              },
            ]}
          >
            <Text style={[styles.actionText, { color: palette.ink }]}>
              Keep talking
            </Text>
          </Pressable>
          <Pressable
            testID="finish-session"
            accessibilityRole="button"
            accessibilityLabel="Finish session"
            onPress={onFinish}
            style={[styles.codaPrimary, { backgroundColor: palette.control }]}
          >
            <Text style={[styles.actionText, { color: palette.controlText }]}>
              Finish session
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function formatLatency(value?: number): string {
  return value === undefined ? "—" : `${Math.round(value)} ms`;
}

function correctionNotesForTurn(turn: ChatTurn): string[] {
  return turn.corrections
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
}

function memorableMoments(turns: ChatTurn[]): string[] {
  const correctionMoments = turns.flatMap((turn) =>
    correctionNotesForTurn(turn).map((note) => note.split(" — ")[0]),
  );
  const spokenMoments = turns
    .filter((turn) => turn.role === "user" && turn.textJa.trim())
    .map((turn) => turn.textJa.trim());
  return [...new Set([...correctionMoments, ...spokenMoments])].slice(-3);
}

function AcousticAtmosphere({ palette }: { palette: ConversationPalette }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={[
          styles.ambientRule,
          { backgroundColor: palette.hairline, left: "18%" },
        ]}
      />
      <View
        style={[
          styles.ambientRule,
          { backgroundColor: palette.hairline, right: "18%" },
        ]}
      />
      <View
        style={[
          styles.ambientCircle,
          { borderColor: palette.seamSoft, backgroundColor: palette.seamSoft },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    minHeight: 68,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 2,
  },
  headerPill: {
    minWidth: 72,
    height: CONVERSATION_TARGET.minimum,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  headerAction: { fontSize: 13, fontWeight: "600" },
  sessionLabel: {
    position: "absolute",
    left: 96,
    right: 96,
    alignItems: "center",
  },
  sessionKicker: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 1.4,
    lineHeight: 13,
  },
  sessionTitle: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  headerIcon: {
    width: CONVERSATION_TARGET.roundIcon,
    height: CONVERSATION_TARGET.roundIcon,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  stage: {
    flex: 1,
    minHeight: 390,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  utterancePlaceholder: { height: 76 },
  utterance: {
    minHeight: 76,
    maxWidth: 620,
    alignItems: "center",
    paddingHorizontal: 18,
  },
  utteranceRole: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 1.2,
    marginBottom: 7,
  },
  utteranceText: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 20,
    lineHeight: 30,
    textAlign: "center",
  },
  srStatus: { position: "absolute", width: 1, height: 1, opacity: 0 },
  lifecyclePanel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 13,
    paddingBottom: 12,
  },
  editorialLabel: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 1.35,
    lineHeight: 13,
  },
  panelInstruction: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  transcriptInput: {
    minHeight: CONVERSATION_TARGET.action,
    maxHeight: 92,
    borderBottomWidth: 1,
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 18,
    lineHeight: 26,
    paddingHorizontal: 0,
    paddingVertical: 10,
  },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  secondaryAction: {
    flex: 1,
    minHeight: CONVERSATION_TARGET.action,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  primaryAction: {
    flex: 1,
    minHeight: CONVERSATION_TARGET.action,
    borderRadius: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  recoveryAction: {
    minHeight: CONVERSATION_TARGET.action,
    borderRadius: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 16,
  },
  actionText: { fontSize: 14, fontWeight: "700" },
  latency: {
    fontFamily: "SFMono-Regular",
    fontSize: 8,
    letterSpacing: 0.8,
    textAlign: "center",
    paddingVertical: 4,
  },
  phraseHelp: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  correctionMoment: {
    minHeight: 74,
    borderLeftWidth: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingLeft: 12,
  },
  correctionCopy: { flex: 1 },
  correctionText: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  inlineIconButton: {
    width: CONVERSATION_TARGET.minimum,
    height: CONVERSATION_TARGET.minimum,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  speakDock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  ambientRule: {
    position: "absolute",
    top: 76,
    bottom: 86,
    width: StyleSheet.hairlineWidth,
    opacity: 0.52,
  },
  ambientCircle: {
    position: "absolute",
    width: 430,
    height: 430,
    borderRadius: 215,
    borderWidth: 1,
    opacity: 0.18,
    left: "50%",
    top: "47%",
    marginLeft: -215,
    marginTop: -215,
  },
  codaSafeArea: { flex: 1 },
  codaHeader: {
    minHeight: 112,
    paddingHorizontal: 20,
    paddingTop: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  codaBody: { flex: 1, justifyContent: "center", paddingHorizontal: 26 },
  codaTitle: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 32,
    fontWeight: "600",
    lineHeight: 44,
  },
  codaSubtitle: { fontSize: 13, lineHeight: 19, marginTop: 6, maxWidth: 380 },
  momentList: { marginTop: 34 },
  momentRow: {
    minHeight: 76,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
  },
  momentNumber: { fontFamily: "SFMono-Medium", fontSize: 10 },
  momentText: {
    flex: 1,
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 17,
    lineHeight: 25,
  },
  codaActions: { paddingHorizontal: 20, paddingBottom: 10, gap: 10 },
  codaSecondary: {
    minHeight: CONVERSATION_TARGET.codaAction,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  codaPrimary: {
    minHeight: CONVERSATION_TARGET.codaAction,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
});
