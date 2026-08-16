import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
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

import { useSession, type ChatTurn } from "@/stores/useSession";
import { MicButton } from "@/components/MicButton";
import { AcousticVoiceForm } from "@/components/AcousticVoiceForm";
import { PronunciationFeedbackCard } from "@/components/PronunciationFeedbackCard";
import {
  type ConversationPalette,
  useConversationPalette,
} from "@/theme/conversation";
import { CONVERSATION_TARGET } from "@/theme/interaction";
import {
  VOICE_PHASE_COPY,
  type VoiceLatency,
  type VoiceLifecycle,
} from "@/voice/lifecycle";
import { useConversationEngine } from "@/voice/useConversationEngine";
import {
  buildSessionCloseout,
  type LearningMomentDecision,
  type SessionCloseout,
} from "@/db/sessionHistory";

export default function SessionScreen() {
  const router = useRouter();
  const palette = useConversationPalette();
  const { id, intro } = useLocalSearchParams<{
    id: string;
    intro?: string;
  }>();
  const session = useSession();
  const { engine, state: engineState } = useConversationEngine(id, intro);
  const { draftTranscript, audioEnergy, retryingTurnId, showCoda } =
    engineState;
  const [dismissedCorrectionId, setDismissedCorrectionId] = useState<
    string | null
  >(null);
  const diagnosticRunStartedRef = useRef(false);

  useEffect(() => {
    void engine.start().then(() => {
      if (!__DEV__) return;
      const reviewPhase = process.env.EXPO_PUBLIC_KOE_REVIEW_PHASE as
        | VoiceLifecycle["phase"]
        | undefined;
      if (reviewPhase && reviewPhase in VOICE_PHASE_COPY) {
        engine.setReviewState({
          phase: reviewPhase,
          draftTranscript:
            reviewPhase === "transcriptCheck"
              ? "明日は友達と京都へ行きます。"
              : undefined,
          audioEnergy:
            reviewPhase === "listening" || reviewPhase === "speaking"
              ? 0.62
              : undefined,
        });
      }
      if (process.env.EXPO_PUBLIC_KOE_REVIEW_CODA === "1") {
        const store = useSession.getState();
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
        engine.setReviewState({ showCoda: true });
      }
    });
  }, [engine]);

  useEffect(() => {
    const injectionUri = process.env.EXPO_PUBLIC_KOE_INJECT_AUDIO_URI;
    if (!__DEV__ || !injectionUri || diagnosticRunStartedRef.current) {
      return;
    }
    diagnosticRunStartedRef.current = true;
    void engine.injectRecordedAudio({
      uri: injectionUri,
      filename: process.env.EXPO_PUBLIC_KOE_INJECT_AUDIO_FILENAME,
      mimeType: process.env.EXPO_PUBLIC_KOE_INJECT_AUDIO_MIME_TYPE,
    });
  }, [engine]);

  const onPressIn = () => {
    void engine.startListening();
  };
  const onPressOut = () => {
    void engine.stopListening();
  };
  const submitTranscript = () => {
    void engine.submitTranscript();
  };
  const recoverVoice = () => {
    void engine.recover();
  };
  const discardTranscript = () => engine.discardTranscript();
  const setDraftTranscript = (text: string) => engine.editTranscript(text);
  const startPronunciationRetry = (turn: ChatTurn) => {
    void engine.startPronunciationRetry(turn.id);
  };
  const play = (audioUri: string) => engine.playAudio(audioUri);
  const endSession = () => engine.requestEnd();
  const setShowCoda = (visible: boolean) => {
    if (!visible) engine.continueAfterCoda();
  };
  const finishSession = async () => {
    try {
      await engine.finishEnd();
      router.back();
    } catch {
      Alert.alert(
        "Session not finished",
        "Koe kept this conversation open so none of its learning moments are lost. Try again.",
      );
    }
  };
  const leaveFirstExchange = async () => {
    await engine.endImmediately();
    router.replace("/");
  };
  const canInterrupt = ["understanding", "firstReply", "speaking"].includes(
    session.voice.phase,
  );

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
