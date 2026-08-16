import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Bookmark,
  Check,
  RotateCcw,
  Send,
  Settings,
  Trash2,
  Volume2,
  X,
} from "lucide-react-native";
import { randomUUID } from "expo-crypto";

import { useSession, type ChatTurn } from "@/stores/useSession";
import { KOE_V1_PRODUCT_CONTRACT } from "@/product/v1";
import { startStreaming, STTError } from "@/services/stt";
import { ProviderTimeoutError, streamConversation } from "@/services/llm";
import {
  PCMPlaybackQueue,
  synthesize,
  play,
  stop as stopSpeech,
} from "@/services/tts";
import { MicButton } from "@/components/MicButton";
import { AcousticVoiceForm } from "@/components/AcousticVoiceForm";
import { PronunciationFeedbackCard } from "@/components/PronunciationFeedbackCard";
import { tap, fail as failHaptic, success } from "@/utils/haptics";
import { log } from "@/utils/log";
import {
  analyzePronunciation,
  type PronunciationFeedback,
} from "@/services/pitch";
import { annotate } from "@/services/furigana";
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
import { shouldAutoSendFirstTranscript } from "@/voice/firstExchange";
import {
  buildSessionCloseout,
  type LearningMomentDecision,
  type SessionCloseout,
} from "@/db/sessionHistory";

type FailedReply = { text: string; audioUri?: string; assistantTurnId: string };

export default function SessionScreen() {
  const router = useRouter();
  const palette = useConversationPalette();
  const { id, intro } = useLocalSearchParams<{
    id: string;
    intro?: string;
  }>();
  const session = useSession();

  const [draftTranscript, setDraftTranscript] = useState("");
  const [draftAudioUri, setDraftAudioUri] = useState<string | undefined>();
  const [audioEnergy, setAudioEnergy] = useState(0);
  const [showCoda, setShowCoda] = useState(false);
  const [dismissedCorrectionId, setDismissedCorrectionId] = useState<
    string | null
  >(null);
  const [retryingTurnId, setRetryingTurnId] = useState<string | null>(null);
  const sttHandleRef = useRef<Awaited<
    ReturnType<typeof startStreaming>
  > | null>(null);
  const pressStartRef = useRef(0);
  const responseRunsRef = useRef(new ResponseRunController());
  const failedReplyRef = useRef<FailedReply | null>(null);
  const latencyTrackerRef = useRef(new VoiceLatencyTracker());
  const pendingEnrichmentRef = useRef(new Set<Promise<void>>());
  const presentedPronunciationRef = useRef<string | null>(null);
  const closeoutPreparationRef = useRef<Promise<unknown>>(Promise.resolve());
  const voiceSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    if (!id || useSession.getState().id === id) return;
    const store = useSession.getState();
    void store.start(id);
    if (__DEV__) {
      const reviewPhase = process.env.EXPO_PUBLIC_KOE_REVIEW_PHASE as
        | VoiceLifecycle["phase"]
        | undefined;
      if (reviewPhase && reviewPhase in VOICE_PHASE_COPY) {
        store.setVoicePhase(reviewPhase);
        if (reviewPhase === "transcriptCheck") {
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
        store.addTurn({
          id: "review-assistant-1",
          role: "assistant",
          textJa: "いいですね。京都では何を見たいですか？",
          createdAt: Date.now() - 1_000,
        });
        setShowCoda(true);
      }
    }
  }, [id]);

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

  const analyzeUserPronunciation = useCallback(
    async (
      turnId: string,
      targetText: string,
      attemptAudioUri: string,
      previous?: ChatTurn,
    ): Promise<PronunciationFeedback | undefined> => {
      try {
        const targetReading = (await annotate(targetText))
          .map((run) => run.reading ?? run.base)
          .join("");
        const referenceAudioUri =
          previous?.referenceAudioUri ??
          (
            await synthesize(targetText, {
              voice: KOE_V1_PRODUCT_CONTRACT.conversation.voice,
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
        useSession.getState().patchTurn(turnId, {
          referenceAudioUri,
          pronunciation,
        });
        return pronunciation;
      } catch (error) {
        log.warn("pronunciation analysis failed", error);
        return undefined;
      }
    },
    [],
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
      let userTurnId: string | undefined;
      if (retryAssistantTurnId) {
        useSession.getState().patchTurn(assistantTurnId, {
          textJa: "",
          streaming: true,
          interrupted: false,
          corrections: undefined,
        });
      } else {
        userTurnId = randomUUID();
        const userTurn: ChatTurn = {
          id: userTurnId,
          role: "user",
          textJa: trimmed,
          audioUri,
          attemptNumber: audioUri ? 1 : undefined,
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
        if (audioUri) {
          void analyzeUserPronunciation(userTurnId, trimmed, audioUri);
        }
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
        .setVoicePhase(
          retryAssistantTurnId ? "responseRetry" : "understanding",
          {
            interimTranscript: "",
          },
        );
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
        captureKey: assistantTurnId,
        onCaptured: (audioUri) => {
          useSession.getState().patchTurn(assistantTurnId, { audioUri });
        },
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
          history: historyWithUser.slice(0, -1),
          userTurn: trimmed,
          voice: KOE_V1_PRODUCT_CONTRACT.conversation.voice,
          correctionStyle: KOE_V1_PRODUCT_CONTRACT.conversation.correctionStyle,
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
            if (userTurnId) {
              const enrichment = result.feedback.then(async (feedback) => {
                const store = useSession.getState();
                store.patchTurn(userTurnId!, {
                  corrections: feedback.corrections,
                  textEn: feedback.translations.user,
                });
                store.patchTurn(assistantTurnId, {
                  textEn: feedback.translations.tutor,
                });
                if (store.closeout) await store.prepareCloseout();
              });
              pendingEnrichmentRef.current.add(enrichment);
              void enrichment.finally(() => {
                pendingEnrichmentRef.current.delete(enrichment);
              });
            }
            failedReplyRef.current = null;
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
                  voice: KOE_V1_PRODUCT_CONTRACT.conversation.voice,
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
    [analyzeUserPronunciation, settleReply, updateLatency],
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
    useSession
      .getState()
      .setVoicePhase(retryingTurnId ? "retryListening" : "listening", {
        interimTranscript: "",
      });

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
  }, [retryingTurnId, updateLatency]);

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
      if (
        shouldAutoSendFirstTranscript({
          intro,
          existingTurnCount: useSession.getState().turns.length,
          transcript: result.fullText,
        })
      ) {
        setDraftTranscript("");
        setDraftAudioUri(undefined);
        useSession
          .getState()
          .setVoicePhase("understanding", { interimTranscript: "" });
        void sendUser(result.fullText, result.audioUri || undefined);
        return;
      }
      useSession.getState().setVoicePhase("transcriptCheck", {
        interimTranscript: result.fullText,
      });
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
  }, [intro, sendUser]);

  const submitPronunciationRetry = useCallback(
    async (previous: ChatTurn, transcript: string, audioUri: string) => {
      const targetText = previous.pronunciation?.targetText ?? previous.textJa;
      const turnId = randomUUID();
      const retryTurn: ChatTurn = {
        id: turnId,
        role: "user",
        textJa: transcript,
        audioUri,
        referenceAudioUri: previous.referenceAudioUri,
        retryOfTurnId: previous.id,
        attemptNumber: (previous.attemptNumber ?? 1) + 1,
        createdAt: Date.now(),
      };
      useSession.getState().addTurn(retryTurn);
      setRetryingTurnId(null);
      setDraftTranscript("");
      setDraftAudioUri(undefined);
      useSession.getState().setVoicePhase("comparing", {
        interimTranscript: "",
      });
      const result = await analyzeUserPronunciation(
        turnId,
        targetText,
        audioUri,
        previous,
      );
      if (result) {
        useSession.getState().setVoicePhase("success");
        result.retry?.targetImproved ? success() : tap();
      } else {
        useSession.getState().setVoice(voiceError("sttFailure"));
      }
      if (voiceSettleTimerRef.current)
        clearTimeout(voiceSettleTimerRef.current);
      voiceSettleTimerRef.current = setTimeout(() => {
        if (useSession.getState().voice.phase === "success") {
          useSession.getState().setVoicePhase("idle");
        }
      }, 1_400);
    },
    [analyzeUserPronunciation],
  );

  const submitTranscript = useCallback(() => {
    const text = draftTranscript.trim();
    if (!text) {
      useSession.getState().setVoice(voiceError("silence"));
      return;
    }
    if (retryingTurnId) {
      const previous = useSession
        .getState()
        .turns.find((turn) => turn.id === retryingTurnId);
      if (previous && draftAudioUri) {
        void submitPronunciationRetry(previous, text, draftAudioUri);
        return;
      }
      setRetryingTurnId(null);
      useSession.getState().setVoice(voiceError("sttFailure"));
      return;
    }
    setDraftTranscript("");
    useSession
      .getState()
      .setVoicePhase("understanding", { interimTranscript: "" });
    void sendUser(text, draftAudioUri);
  }, [
    draftAudioUri,
    draftTranscript,
    retryingTurnId,
    sendUser,
    submitPronunciationRetry,
  ]);

  const recoverVoice = useCallback(() => {
    const recovery = useSession.getState().voice.recovery;
    if (recovery === "openSettings") {
      void Linking.openSettings();
      return;
    }
    if (recovery === "retryResponse" && failedReplyRef.current) {
      const failed = failedReplyRef.current;
      useSession.getState().setVoicePhase("responseRetry");
      void sendUser(failed.text, failed.audioUri, failed.assistantTurnId);
      return;
    }
    useSession.getState().setVoicePhase("idle", { interimTranscript: "" });
  }, [sendUser]);

  const discardTranscript = useCallback(() => {
    setDraftTranscript("");
    setDraftAudioUri(undefined);
    setAudioEnergy(0);
    setRetryingTurnId(null);
    useSession.getState().setVoicePhase("idle", { interimTranscript: "" });
  }, []);

  const endSession = () => {
    tap();
    responseRunsRef.current.interrupt();
    setAudioEnergy(0);
    setShowCoda(true);
    closeoutPreparationRef.current = Promise.all([
      sttHandleRef.current?.cancel() ?? Promise.resolve(),
      stopSpeech(),
    ]).then(() => useSession.getState().prepareCloseout());
  };

  const finishSession = async () => {
    try {
      await closeoutPreparationRef.current;
      await Promise.allSettled([...pendingEnrichmentRef.current]);
      await useSession.getState().end();
      setShowCoda(false);
      router.back();
    } catch {
      Alert.alert(
        "Session not finished",
        "Koe kept this conversation open so none of its learning moments are lost. Try again.",
      );
    }
  };

  const canInterrupt = ["understanding", "firstReply", "speaking"].includes(
    session.voice.phase,
  );

  const startPronunciationRetry = useCallback((turn: ChatTurn) => {
    tap();
    responseRunsRef.current.interrupt();
    void stopSpeech();
    setRetryingTurnId(turn.id);
    setDraftTranscript("");
    setDraftAudioUri(undefined);
    useSession
      .getState()
      .setVoicePhase("retryListening", { interimTranscript: "" });
  }, []);

  const leaveFirstExchange = useCallback(async () => {
    responseRunsRef.current.interrupt();
    await Promise.allSettled([
      sttHandleRef.current?.cancel() ?? Promise.resolve(),
      stopSpeech(),
    ]);
    await useSession.getState().end();
    router.replace("/");
  }, [router]);

  const latestTurn = [...session.turns]
    .reverse()
    .find((turn) => Boolean(turn.textJa));
  const latestCorrection = [...session.turns]
    .reverse()
    .find(
      (turn) =>
        turn.role === "user" &&
        turn.id !== dismissedCorrectionId &&
        correctionNotesForTurn(turn).length > 0,
    );
  const latestPronunciation = [...session.turns]
    .reverse()
    .find((turn) => turn.role === "user" && Boolean(turn.pronunciation));
  const previousPronunciation = latestPronunciation?.retryOfTurnId
    ? session.turns.find(
        (turn) => turn.id === latestPronunciation.retryOfTurnId,
      )
    : undefined;
  const retryTarget = retryingTurnId
    ? session.turns.find((turn) => turn.id === retryingTurnId)
    : undefined;
  const liveText =
    retryTarget && session.voice.phase === "idle"
      ? (retryTarget.pronunciation?.targetText ?? retryTarget.textJa)
      : session.voice.phase === "interimTranscript"
        ? session.voice.interimTranscript
        : session.voice.phase === "transcriptCheck"
          ? ""
          : (latestTurn?.textJa ?? "");
  const closeout =
    session.closeout ??
    (session.id ? buildSessionCloseout(session.id, session.turns) : undefined);
  const isFirstExchange = intro === "1" && session.turns.length === 0;
  const isVoiceRecovery = session.voice.phase === "recoverableError";

  useEffect(() => {
    if (
      session.voice.phase !== "idle" ||
      !latestPronunciation?.pronunciation ||
      presentedPronunciationRef.current === latestPronunciation.id
    ) {
      return;
    }
    presentedPronunciationRef.current = latestPronunciation.id;
    useSession.getState().setVoicePhase("feedback");
  }, [
    latestPronunciation?.id,
    latestPronunciation?.pronunciation,
    session.voice.phase,
  ]);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: palette.canvas }]}
    >
      <AcousticAtmosphere palette={palette} />

      <View style={styles.header}>
        <Pressable
          testID="end-session"
          accessibilityRole="button"
          accessibilityLabel={
            isFirstExchange
              ? "Explore Koe without speaking"
              : "End conversation"
          }
          onPress={
            isFirstExchange ? () => void leaveFirstExchange() : endSession
          }
          style={[
            styles.headerPill,
            {
              borderColor: palette.hairline,
              backgroundColor: "transparent",
            },
          ]}
        >
          <X color={palette.ink} size={16} />
          <Text style={[styles.headerAction, { color: palette.ink }]}>
            {isFirstExchange ? "Not now" : "End"}
          </Text>
        </Pressable>

        <View style={styles.sessionLabel} pointerEvents="none">
          <Text style={[styles.sessionKicker, { color: palette.muted }]}>
            {isFirstExchange ? "FIRST EXCHANGE" : "LIVE CONVERSATION"}
          </Text>
          <Text style={[styles.sessionTitle, { color: palette.ink }]}>
            {isFirstExchange ? "No setup needed" : "Open conversation"}
          </Text>
        </View>

        <View
          style={[styles.headerIcon, { borderColor: "transparent" }]}
          accessibilityElementsHidden
        />
      </View>

      <ScrollView
        style={styles.conversationScroll}
        contentContainerStyle={styles.conversationContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.stage, isVoiceRecovery && styles.stageCompact]}>
          <AcousticVoiceForm
            phase={session.voice.phase}
            energy={audioEnergy}
            compact={isVoiceRecovery}
          />
          {isFirstExchange && !isVoiceRecovery ? (
            <FirstExchangePrompt palette={palette} />
          ) : (
            <CurrentUtterance
              text={liveText}
              isKoe={!retryTarget && latestTurn?.role === "assistant"}
              palette={palette}
            />
          )}
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

        {latestPronunciation?.pronunciation &&
        ["idle", "feedback"].includes(session.voice.phase) ? (
          <PronunciationFeedbackCard
            feedback={latestPronunciation.pronunciation}
            palette={palette}
            attemptAudioUri={latestPronunciation.audioUri}
            referenceAudioUri={latestPronunciation.referenceAudioUri}
            previous={
              previousPronunciation?.pronunciation
                ? {
                    feedback: previousPronunciation.pronunciation,
                    audioUri: previousPronunciation.audioUri,
                  }
                : undefined
            }
            onPlay={(uri) => void play(uri)}
            onRetry={() => startPronunciationRetry(latestPronunciation)}
          />
        ) : latestCorrection && session.voice.phase === "idle" ? (
          <CorrectionMoment
            turn={latestCorrection}
            palette={palette}
            onDismiss={() => setDismissedCorrectionId(latestCorrection.id)}
            onReplay={
              latestCorrection.audioUri
                ? () => void play(latestCorrection.audioUri!)
                : undefined
            }
          />
        ) : null}
      </ScrollView>

      <View style={[styles.speakDock, { borderColor: palette.hairline }]}>
        <MicButton
          recording={session.isRecording}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          prompt={
            retryTarget
              ? "Hold to retry the highlighted phrase"
              : canInterrupt
                ? "Hold to interrupt"
                : undefined
          }
          palette={palette}
        />
      </View>

      <SessionCoda
        visible={showCoda}
        closeout={closeout}
        palette={palette}
        onContinue={() => setShowCoda(false)}
        onDecision={(momentId, decision) =>
          void useSession.getState().setMomentDecision(momentId, decision)
        }
        onFinish={() => void finishSession()}
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
    voice.phase === "transcriptCheck" || voice.phase === "recoverableError";

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
          {voice.phase === "transcriptCheck" ? (
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

function FirstExchangePrompt({ palette }: { palette: ConversationPalette }) {
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel="Your first exchange. Hold the microphone, say a line, then release. Koe will answer and show one sound to tune. You can speak Japanese or English. The first hold asks for microphone and speech recognition access."
      style={styles.firstExchange}
    >
      <Text style={[styles.firstExchangeLabel, { color: palette.proof }]}>
        YOUR FIRST LINE / 最初の声
      </Text>
      <Text style={[styles.firstExchangeTitle, { color: palette.ink }]}>
        こんにちは
      </Text>
      <Text style={[styles.firstExchangeInstruction, { color: palette.ink }]}>
        Hold the mic, say a line, then release.
      </Text>
      <Text style={[styles.firstExchangeDetail, { color: palette.muted }]}>
        Say this, or start in English. Koe will answer and show one sound to
        tune.
      </Text>
      <View style={[styles.permissionNote, { borderColor: palette.hairline }]}>
        <Text style={[styles.permissionText, { color: palette.muted }]}>
          The first hold asks for microphone and speech recognition access.
        </Text>
      </View>
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
  onReplay?: () => void;
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
      {onReplay ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Replay your line"
          onPress={onReplay}
          style={[styles.inlineIconButton, { borderColor: palette.hairline }]}
        >
          <Volume2 color={palette.ink} size={17} />
        </Pressable>
      ) : null}
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
  closeout,
  palette,
  onContinue,
  onDecision,
  onFinish,
}: {
  visible: boolean;
  closeout?: SessionCloseout;
  palette: ConversationPalette;
  onContinue: () => void;
  onDecision: (momentId: string, decision: LearningMomentDecision) => void;
  onFinish: () => void;
}) {
  const moments = closeout?.moments ?? [];
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
        <ScrollView
          style={styles.codaScroll}
          contentContainerStyle={styles.codaBody}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.codaTitle, { color: palette.ink }]}>
            今日、残った声
          </Text>
          <Text style={[styles.codaSubtitle, { color: palette.muted }]}>
            Keep what helps. Discard the rest. Koe will not turn this into a
            chat archive.
          </Text>
          <View style={styles.momentList}>
            {moments.length ? (
              moments.map((moment) => (
                <View
                  key={moment.id}
                  style={[
                    styles.momentRow,
                    {
                      borderColor:
                        moment.decision === "saved"
                          ? palette.success
                          : palette.hairline,
                      opacity: moment.decision === "discarded" ? 0.56 : 1,
                    },
                  ]}
                >
                  <View style={styles.momentCopy}>
                    <Text style={[styles.momentKind, { color: palette.proof }]}>
                      {momentKindLabel(moment.kind)}
                    </Text>
                    <Text style={[styles.momentText, { color: palette.ink }]}>
                      {moment.textJa}
                    </Text>
                    {moment.textEn ? (
                      <Text
                        style={[
                          styles.momentTranslation,
                          { color: palette.muted },
                        ]}
                      >
                        {moment.textEn}
                      </Text>
                    ) : null}
                    {moment.note ? (
                      <Text
                        style={[styles.momentNote, { color: palette.muted }]}
                      >
                        {moment.note}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.momentActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Keep ${moment.textJa}`}
                      accessibilityState={{
                        selected: moment.decision === "saved",
                      }}
                      onPress={() => onDecision(moment.id, "saved")}
                      style={[
                        styles.momentAction,
                        {
                          borderColor: palette.hairline,
                          backgroundColor:
                            moment.decision === "saved"
                              ? palette.control
                              : "transparent",
                        },
                      ]}
                    >
                      {moment.decision === "saved" ? (
                        <Check color={palette.controlText} size={16} />
                      ) : (
                        <Bookmark color={palette.ink} size={16} />
                      )}
                      <Text
                        style={[
                          styles.momentActionText,
                          {
                            color:
                              moment.decision === "saved"
                                ? palette.controlText
                                : palette.ink,
                          },
                        ]}
                      >
                        {moment.decision === "saved" ? "Kept" : "Keep"}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Discard ${moment.textJa}`}
                      accessibilityState={{
                        selected: moment.decision === "discarded",
                      }}
                      onPress={() => onDecision(moment.id, "discarded")}
                      style={[
                        styles.momentAction,
                        { borderColor: palette.hairline },
                      ]}
                    >
                      <Trash2 color={palette.muted} size={16} />
                      <Text
                        style={[
                          styles.momentActionText,
                          { color: palette.muted },
                        ]}
                      >
                        {moment.decision === "discarded"
                          ? "Discarded"
                          : "Discard"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))
            ) : (
              <View
                style={[styles.momentRow, { borderColor: palette.hairline }]}
              >
                <Text style={[styles.momentText, { color: palette.ink }]}>
                  Keep talking to make a moment worth carrying forward.
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
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

function momentKindLabel(kind: "expression" | "correction" | "retry") {
  if (kind === "correction") return "THE CORRECTION THAT MATTERED";
  if (kind === "retry") return "STRONGEST RETRY";
  return "EXPRESSION WORTH KEEPING";
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
  conversationScroll: { flex: 1 },
  conversationContent: { flexGrow: 1 },
  header: {
    minHeight: 88,
    paddingTop: 20,
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
  stageCompact: { minHeight: 286 },
  utterancePlaceholder: { height: 76 },
  firstExchange: {
    minHeight: 178,
    maxWidth: 420,
    alignItems: "center",
    paddingHorizontal: 18,
  },
  firstExchangeLabel: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 1.25,
    lineHeight: 13,
  },
  firstExchangeTitle: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 34,
    lineHeight: 48,
    marginTop: 4,
  },
  firstExchangeInstruction: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
    textAlign: "center",
    marginTop: 5,
  },
  firstExchangeDetail: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 5,
    maxWidth: 320,
  },
  permissionNote: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
    paddingTop: 9,
    paddingHorizontal: 12,
  },
  permissionText: { fontSize: 10, lineHeight: 15, textAlign: "center" },
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
  codaScroll: { flex: 1 },
  codaBody: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 26,
    paddingVertical: 24,
  },
  codaTitle: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 32,
    fontWeight: "600",
    lineHeight: 44,
  },
  codaSubtitle: { fontSize: 13, lineHeight: 19, marginTop: 6, maxWidth: 380 },
  momentList: { marginTop: 26, gap: 10 },
  momentRow: {
    minHeight: 118,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 14,
    gap: 12,
  },
  momentCopy: { gap: 4 },
  momentKind: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1.15,
    lineHeight: 12,
  },
  momentText: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 17,
    lineHeight: 25,
  },
  momentTranslation: { fontSize: 12, lineHeight: 17 },
  momentNote: { fontSize: 11, lineHeight: 16 },
  momentActions: { flexDirection: "row", gap: 8 },
  momentAction: {
    minHeight: CONVERSATION_TARGET.minimum,
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  momentActionText: { fontSize: 12, fontWeight: "700" },
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
