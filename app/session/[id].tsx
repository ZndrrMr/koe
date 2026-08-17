import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { RotateCcw, Send, Volume2, X } from "lucide-react-native";

import { useKoeIllustration } from "@/art/koeIllustrations";
import { AcousticVoiceForm } from "@/components/AcousticVoiceForm";
import { MicButton } from "@/components/MicButton";
import { PronunciationFeedbackCard } from "@/components/PronunciationFeedbackCard";
import { SafeAreaScreen } from "@/components/SafeAreaScreen";
import { WholeAffordancePressable } from "@/components/WholeAffordancePressable";
import {
  buildSessionCloseout,
  type SessionCloseout,
} from "@/db/sessionHistory";
import { useSession, type ChatTurn } from "@/stores/useSession";
import {
  type ConversationPalette,
  useConversationPalette,
} from "@/theme/conversation";
import {
  CONTROL_MAX_FONT_SIZE_MULTIPLIER,
  CONVERSATION_TARGET,
} from "@/theme/interaction";
import type { ConversationPhase } from "@/voice/conversationEngine";
import { VOICE_PHASE_COPY, type VoiceLifecycle } from "@/voice/lifecycle";
import { useConversationEngine } from "@/voice/useConversationEngine";

type CloseoutStage = "ending" | "coda";

export default function SessionScreen() {
  const router = useRouter();
  const palette = useConversationPalette();
  const microphoneIllustration = useKoeIllustration("microphoneEducation");
  const recoveryIllustration = useKoeIllustration("recovery");
  const endingIllustration = useKoeIllustration("homeStart");
  const codaIllustration = useKoeIllustration("coda");
  const { height } = useWindowDimensions();
  const compact = height < 740;
  const { id, intro, autostart } = useLocalSearchParams<{
    id: string;
    intro?: string;
    autostart?: string;
  }>();
  const session = useSession();
  const { engine, state: engineState } = useConversationEngine(id, intro);
  const { draftTranscript, retryingTurnId, showCoda, handsFreeActive } =
    engineState;
  const [dismissedCorrectionId, setDismissedCorrectionId] = useState<
    string | null
  >(null);
  const [closeoutStage, setCloseoutStage] = useState<CloseoutStage>("ending");
  const diagnosticRunStartedRef = useRef(false);
  const autoStartAppliedRef = useRef(false);
  const reviewStateAppliedRef = useRef(false);

  useEffect(() => {
    void engine.start().then(() => {
      if (autostart === "1" && !autoStartAppliedRef.current) {
        autoStartAppliedRef.current = true;
        void engine.startHandsFree();
      }
      if (!__DEV__ || reviewStateAppliedRef.current) return;
      reviewStateAppliedRef.current = true;
      const reviewPhase = process.env.EXPO_PUBLIC_KOE_REVIEW_PHASE as
        | VoiceLifecycle["phase"]
        | undefined;
      if (reviewPhase && reviewPhase in VOICE_PHASE_COPY) {
        const store = useSession.getState();
        if (reviewPhase !== "idle") {
          store.addTurn({
            id: `review-${reviewPhase}`,
            role: reviewPhase === "speaking" ? "assistant" : "user",
            textJa:
              reviewPhase === "speaking"
                ? "いいですね。京都では何を見たいですか？"
                : "週末は友達と京都へ行きます。",
            createdAt: Date.now() - 1_000,
            corrections:
              reviewPhase === "feedback"
                ? {
                    particles: [
                      {
                        original: "京都に行きます",
                        corrected: "京都へ行きます",
                        explanation: "へ emphasizes the direction of travel.",
                      },
                    ],
                    register: { consistent: true },
                    other: [],
                  }
                : undefined,
          });
        }
        engine.setReviewState({
          phase: reviewPhase,
          draftTranscript:
            reviewPhase === "transcriptCheck"
              ? "明日は友達と京都へ行きます。"
              : undefined,
        });
        if (reviewPhase === "recoverableError") {
          store.setVoice({
            phase: "recoverableError",
            interimTranscript: "",
            errorKind: "network",
            message:
              "Your last spoken turn did not reach Koe. Nothing was added.",
            recovery: "retryResponse",
          });
        }
      }
      const reviewCloseout =
        process.env.EXPO_PUBLIC_KOE_REVIEW_CLOSEOUT ??
        (process.env.EXPO_PUBLIC_KOE_REVIEW_CODA === "1" ? "coda" : "");
      if (reviewCloseout === "ending") {
        setCloseoutStage("ending");
        engine.setReviewState({ showCoda: true });
      }
      if (reviewCloseout === "coda") {
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
        setCloseoutStage("coda");
        engine.setReviewState({ showCoda: true });
      }
    });
  }, [autostart, engine]);

  useEffect(() => {
    const injectionUris = (
      process.env.EXPO_PUBLIC_KOE_INJECT_AUDIO_URIS ??
      process.env.EXPO_PUBLIC_KOE_INJECT_AUDIO_URI ??
      ""
    )
      .split("|")
      .map((uri: string) => uri.trim())
      .filter(Boolean);
    if (!__DEV__ || !injectionUris.length || diagnosticRunStartedRef.current) {
      return;
    }
    diagnosticRunStartedRef.current = true;
    void (async () => {
      for (const uri of injectionUris) {
        await engine.injectRecordedAudio({
          uri,
          filename:
            injectionUris.length === 1
              ? process.env.EXPO_PUBLIC_KOE_INJECT_AUDIO_FILENAME
              : decodeURIComponent(new URL(uri).pathname.split("/").pop()!),
          mimeType: process.env.EXPO_PUBLIC_KOE_INJECT_AUDIO_MIME_TYPE,
        });
      }
    })();
  }, [engine]);

  const submitTranscript = () => void engine.submitTranscript();
  const recoverVoice = () => void engine.recover();
  const discardTranscript = () => engine.discardTranscript();
  const setDraftTranscript = (text: string) => engine.editTranscript(text);
  const startPronunciationRetry = (turn: ChatTurn) =>
    void engine.startPronunciationRetry(turn.id);
  const play = (audioUri: string) => engine.playAudio(audioUri);
  const endSession = () => {
    setCloseoutStage("ending");
    engine.requestEnd();
  };
  const continueConversation = () => engine.continueAfterCoda();
  const finishSession = async () => {
    try {
      await engine.finishEnd();
      router.replace("/");
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
  const handleHandsFreeControl = () => {
    if (session.voice.phase === "recoverableError") {
      void engine.recover();
    } else if (canInterrupt) {
      void engine.bargeIn();
    } else if (handsFreeActive) {
      void engine.pauseHandsFree();
    } else {
      void engine.startHandsFree();
    }
  };

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
  const isFirstExchange =
    intro === "1" &&
    session.turns.length === 0 &&
    !handsFreeActive &&
    session.voice.phase === "idle";
  const isVoiceRecovery = session.voice.phase === "recoverableError";
  const controlPhase: ConversationPhase =
    session.voice.phase === "speaking"
      ? "speaking"
      : ["understanding", "firstReply", "responseRetry"].includes(
            session.voice.phase,
          )
        ? "understanding"
        : engineState.phase;
  const controlActive =
    handsFreeActive ||
    ["listening", "interimTranscript", "retryListening"].includes(
      session.voice.phase,
    );

  return (
    <SafeAreaScreen
      style={[styles.safeArea, { backgroundColor: palette.canvas }]}
    >
      <SessionHeader
        palette={palette}
        firstExchange={isFirstExchange}
        onEnd={isFirstExchange ? () => void leaveFirstExchange() : endSession}
      />

      <ScrollView
        style={styles.conversationScroll}
        contentContainerStyle={styles.conversationContent}
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical={false}
        showsVerticalScrollIndicator={false}
      >
        {isVoiceRecovery ? (
          <RecoveryState
            voice={session.voice}
            palette={palette}
            illustration={recoveryIllustration}
            compact={compact}
            onRecover={recoverVoice}
            onEnd={endSession}
          />
        ) : isFirstExchange ? (
          <FirstExchangePrompt
            palette={palette}
            illustration={microphoneIllustration}
            compact={compact}
          />
        ) : (
          <>
            <View style={[styles.stage, compact && styles.compactStage]}>
              <AcousticVoiceForm
                phase={session.voice.phase}
                compact={compact}
              />
              <Text style={[styles.stateDetail, { color: palette.muted }]}>
                {VOICE_PHASE_COPY[session.voice.phase].detail}
              </Text>
              <CurrentUtterance
                text={liveText}
                isKoe={!retryTarget && latestTurn?.role === "assistant"}
                palette={palette}
              />
            </View>

            <TranscriptCheckPanel
              voice={session.voice}
              palette={palette}
              draftTranscript={draftTranscript}
              onChangeTranscript={setDraftTranscript}
              onSubmit={submitTranscript}
              onDiscard={discardTranscript}
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
            ) : latestCorrection &&
              ["idle", "feedback"].includes(session.voice.phase) ? (
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
          </>
        )}
      </ScrollView>

      {!isVoiceRecovery ? (
        <View style={styles.speakDock}>
          {isFirstExchange ? (
            <RuledSessionAction
              testID="hands-free-control"
              label="Continue"
              hint="Requests microphone access and begins continuous turn-taking"
              palette={palette}
              onPress={handleHandsFreeControl}
            />
          ) : (
            <MicButton
              active={controlActive}
              phase={controlPhase}
              recovery={session.voice.recovery}
              onPress={handleHandsFreeControl}
              palette={palette}
            />
          )}
        </View>
      ) : null}

      <SessionCloseout
        visible={showCoda}
        stage={closeoutStage}
        closeout={closeout}
        palette={palette}
        endingIllustration={endingIllustration}
        codaIllustration={codaIllustration}
        onContinue={continueConversation}
        onShowCoda={() => setCloseoutStage("coda")}
        onFinish={() => void finishSession()}
      />
    </SafeAreaScreen>
  );
}

function SessionHeader({
  palette,
  firstExchange,
  onEnd,
}: {
  palette: ConversationPalette;
  firstExchange: boolean;
  onEnd: () => void;
}) {
  const label = firstExchange ? "Not now" : "End";
  return (
    <View style={styles.header}>
      <WholeAffordancePressable
        testID="end-session"
        accessibilityRole="button"
        accessibilityLabel={
          firstExchange ? "Explore Koe without speaking" : "End conversation"
        }
        accessibilityHint={
          firstExchange
            ? "Returns home without using the microphone"
            : "Opens the end conversation choices"
        }
        onPress={onEnd}
        style={({ pressed }) => [
          styles.headerAction,
          { backgroundColor: pressed ? palette.seamSoft : "transparent" },
        ]}
      >
        <X color={palette.ink} size={17} strokeWidth={1.5} />
        <Text
          maxFontSizeMultiplier={CONTROL_MAX_FONT_SIZE_MULTIPLIER}
          style={[styles.headerActionText, { color: palette.ink }]}
        >
          {label}
        </Text>
      </WholeAffordancePressable>
      <View style={styles.lockup} accessibilityRole="header">
        <Text
          maxFontSizeMultiplier={CONTROL_MAX_FONT_SIZE_MULTIPLIER}
          style={[styles.lockupKanji, { color: palette.ink }]}
        >
          声
        </Text>
        <Text
          maxFontSizeMultiplier={CONTROL_MAX_FONT_SIZE_MULTIPLIER}
          style={[styles.lockupLatin, { color: palette.muted }]}
        >
          KOE
        </Text>
      </View>
      <View style={styles.headerBalance} accessibilityElementsHidden />
    </View>
  );
}

function FirstExchangePrompt({
  palette,
  illustration,
  compact,
}: {
  palette: ConversationPalette;
  illustration: ReturnType<typeof useKoeIllustration>;
  compact: boolean;
}) {
  return (
    <View style={styles.firstExchange}>
      <Image
        source={illustration}
        resizeMode="contain"
        accessible
        accessibilityRole="image"
        accessibilityLabel="Two engraved voice contours turn toward one another."
        accessibilityIgnoresInvertColors
        style={[styles.microphoneArt, compact && styles.compactMicrophoneArt]}
      />
      <Text style={[styles.editorialLabel, { color: palette.seam }]}>
        FIRST VOICE
      </Text>
      <Text style={[styles.displayLarge, { color: palette.ink }]}>
        Let Koe hear your voice.
      </Text>
      <Text style={[styles.jpBody, { color: palette.ink }]}>
        声を聞かせてください。
      </Text>
      <Text style={[styles.bodyCopy, { color: palette.muted }]}>
        Continue asks for microphone access. Speak Japanese or English; Koe will
        answer aloud and listen again automatically.
      </Text>
    </View>
  );
}

function TranscriptCheckPanel({
  voice,
  palette,
  draftTranscript,
  onChangeTranscript,
  onSubmit,
  onDiscard,
}: {
  voice: VoiceLifecycle;
  palette: ConversationPalette;
  draftTranscript: string;
  onChangeTranscript: (value: string) => void;
  onSubmit: () => void;
  onDiscard: () => void;
}) {
  if (voice.phase !== "transcriptCheck") return null;
  return (
    <View style={[styles.transcriptPanel, { borderColor: palette.hairline }]}>
      <Text style={[styles.editorialLabel, { color: palette.seam }]}>
        HEARD / 聞き取り
      </Text>
      <Text style={[styles.panelInstruction, { color: palette.muted }]}>
        Correct only what Koe misheard, then send.
      </Text>
      <TextInput
        accessibilityLabel="Correct transcript"
        accessibilityHint="Edits the line Koe heard before sending"
        value={draftTranscript}
        onChangeText={onChangeTranscript}
        multiline
        selectionColor={palette.seam}
        style={[
          styles.transcriptInput,
          { color: palette.ink, borderColor: palette.ruleStrong },
        ]}
      />
      <View style={styles.transcriptActions}>
        <WholeAffordancePressable
          testID="discard-transcript"
          accessibilityRole="button"
          accessibilityLabel="Try recording again"
          accessibilityHint="Discards this transcript and starts a new recording"
          onPress={onDiscard}
          style={({ pressed }) => [
            styles.transcriptAction,
            {
              borderColor: palette.hairline,
              backgroundColor: pressed ? palette.seamSoft : "transparent",
            },
          ]}
        >
          <RotateCcw color={palette.ink} size={17} />
          <Text
            maxFontSizeMultiplier={CONTROL_MAX_FONT_SIZE_MULTIPLIER}
            style={[styles.transcriptActionText, { color: palette.ink }]}
          >
            Try again
          </Text>
        </WholeAffordancePressable>
        <WholeAffordancePressable
          testID="send-transcript"
          accessibilityRole="button"
          accessibilityLabel="Send corrected transcript"
          accessibilityHint="Sends the edited line to Koe"
          onPress={onSubmit}
          style={({ pressed }) => [
            styles.transcriptAction,
            {
              borderColor: palette.ruleStrong,
              backgroundColor: pressed ? palette.seamSoft : "transparent",
            },
          ]}
        >
          <Send color={palette.seam} size={17} />
          <Text
            maxFontSizeMultiplier={CONTROL_MAX_FONT_SIZE_MULTIPLIER}
            style={[styles.transcriptActionText, { color: palette.ink }]}
          >
            Send line
          </Text>
        </WholeAffordancePressable>
      </View>
    </View>
  );
}

function RecoveryState({
  voice,
  palette,
  illustration,
  compact,
  onRecover,
  onEnd,
}: {
  voice: VoiceLifecycle;
  palette: ConversationPalette;
  illustration: ReturnType<typeof useKoeIllustration>;
  compact: boolean;
  onRecover: () => void;
  onEnd: () => void;
}) {
  const label =
    voice.recovery === "openSettings"
      ? "Open settings"
      : voice.recovery === "retryResponse"
        ? "Retry response"
        : voice.recovery === "resume"
          ? "Resume"
          : "Try again";
  return (
    <View style={styles.recoveryBody}>
      <View style={styles.recoveryCopy}>
        <Image
          source={illustration}
          resizeMode="contain"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          accessibilityIgnoresInvertColors
          style={[styles.recoveryArt, compact && styles.compactRecoveryArt]}
        />
        <Text style={[styles.editorialLabel, { color: palette.error }]}>
          VOICE PAUSED / 回復
        </Text>
        <Text style={[styles.displayMedium, { color: palette.ink }]}>
          {recoveryHeading(voice)}
        </Text>
        <Text style={[styles.bodyCopy, { color: palette.muted }]}>
          {voice.message ?? VOICE_PHASE_COPY.recoverableError.detail}
        </Text>
      </View>
      <View style={styles.recoveryActions}>
        <RuledSessionAction
          testID="recover-voice"
          label={label}
          hint="Attempts the available recovery and keeps this conversation open"
          palette={palette}
          onPress={onRecover}
        />
        <RuledSessionAction
          testID="recovery-end-conversation"
          label="End conversation"
          hint="Opens the end conversation choices"
          palette={palette}
          onPress={onEnd}
          secondary
        />
      </View>
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
  if (!text) return null;
  return (
    <View
      accessible
      accessibilityLabel={`${isKoe ? "Koe" : "You"}: ${text}`}
      style={[styles.utterance, { borderColor: palette.hairline }]}
    >
      <Text
        numberOfLines={2}
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
  onReplay?: () => void;
}) {
  const note = correctionNotesForTurn(turn)[0];
  if (!note) return null;
  return (
    <View
      accessibilityRole="summary"
      style={[styles.correctionMoment, { borderColor: palette.hairline }]}
    >
      <View style={styles.correctionCopy}>
        <Text style={[styles.editorialLabel, { color: palette.seam }]}>
          ONE USEFUL NOTE / 気づき
        </Text>
        <Text style={[styles.correctionText, { color: palette.ink }]}>
          {note}
        </Text>
      </View>
      <View style={styles.noteActions}>
        {onReplay ? (
          <WholeAffordancePressable
            testID="replay-correction"
            accessibilityRole="button"
            accessibilityLabel="Replay your line"
            accessibilityHint="Plays the recording for this correction note"
            onPress={onReplay}
            style={({ pressed }) => [
              styles.inlineAction,
              {
                borderColor: palette.hairline,
                backgroundColor: pressed ? palette.seamSoft : "transparent",
              },
            ]}
          >
            <Volume2 color={palette.seam} size={18} />
          </WholeAffordancePressable>
        ) : null}
        <WholeAffordancePressable
          testID="dismiss-correction"
          accessibilityRole="button"
          accessibilityLabel="Dismiss note"
          accessibilityHint="Removes this note from the conversation screen"
          onPress={onDismiss}
          style={({ pressed }) => [
            styles.inlineAction,
            {
              borderColor: palette.hairline,
              backgroundColor: pressed ? palette.seamSoft : "transparent",
            },
          ]}
        >
          <X color={palette.ink} size={18} />
        </WholeAffordancePressable>
      </View>
    </View>
  );
}

function SessionCloseout({
  visible,
  stage,
  closeout,
  palette,
  endingIllustration,
  codaIllustration,
  onContinue,
  onShowCoda,
  onFinish,
}: {
  visible: boolean;
  stage: CloseoutStage;
  closeout?: SessionCloseout;
  palette: ConversationPalette;
  endingIllustration: ReturnType<typeof useKoeIllustration>;
  codaIllustration: ReturnType<typeof useKoeIllustration>;
  onContinue: () => void;
  onShowCoda: () => void;
  onFinish: () => void;
}) {
  const moments = (closeout?.moments ?? [])
    .filter((moment) => moment.decision !== "discarded")
    .slice(0, 3);
  return (
    <Modal
      visible={visible}
      animationType="none"
      onRequestClose={stage === "ending" ? onContinue : onFinish}
    >
      <SafeAreaScreen
        accessibilityViewIsModal
        style={[styles.closeoutSafeArea, { backgroundColor: palette.canvas }]}
      >
        <View style={styles.closeoutHeader}>
          <View style={styles.lockup} accessibilityRole="header">
            <Text style={[styles.lockupKanji, { color: palette.ink }]}>声</Text>
            <Text style={[styles.lockupLatin, { color: palette.muted }]}>
              KOE
            </Text>
          </View>
        </View>
        <ScrollView
          style={styles.closeoutScroll}
          contentContainerStyle={styles.closeoutBody}
          alwaysBounceVertical={false}
          showsVerticalScrollIndicator={false}
        >
          {stage === "ending" ? (
            <>
              <Image
                source={endingIllustration}
                resizeMode="contain"
                accessible
                accessibilityRole="image"
                accessibilityLabel="Two engraved voice contours exchange a single thread."
                accessibilityIgnoresInvertColors
                style={styles.endingArt}
              />
              <Text style={[styles.editorialLabel, { color: palette.seam }]}>
                ENDING / 終わりますか
              </Text>
              <Text style={[styles.displayLarge, { color: palette.ink }]}>
                Leave the conversation here?
              </Text>
              <Text style={[styles.bodyCopy, { color: palette.muted }]}>
                Koe will keep up to three useful moments from this exchange. You
                can continue speaking instead.
              </Text>
            </>
          ) : (
            <>
              {moments.length ? (
                <Image
                  source={codaIllustration}
                  resizeMode="cover"
                  accessible={false}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  accessibilityIgnoresInvertColors
                  style={styles.codaArt}
                />
              ) : null}
              <Text style={[styles.editorialLabel, { color: palette.seam }]}>
                TODAY&apos;S THREAD / 余韻
              </Text>
              <Text style={[styles.displayMedium, { color: palette.ink }]}>
                {codaTitle(moments.length)}
              </Text>
              {moments.length ? (
                <View
                  style={[styles.momentList, { borderColor: palette.hairline }]}
                >
                  {moments.map((moment) => (
                    <View
                      key={moment.id}
                      style={[
                        styles.momentRow,
                        { borderColor: palette.hairline },
                      ]}
                    >
                      <Text style={[styles.momentText, { color: palette.ink }]}>
                        {moment.textJa}
                      </Text>
                      {moment.note ? (
                        <Text
                          style={[styles.momentNote, { color: palette.muted }]}
                        >
                          {moment.note}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={[styles.bodyCopy, { color: palette.muted }]}>
                  Nothing needs saving from this exchange. The next conversation
                  starts clean.
                </Text>
              )}
            </>
          )}
        </ScrollView>
        <View style={styles.closeoutActions}>
          {stage === "ending" ? (
            <>
              <RuledSessionAction
                testID="resume-conversation"
                label="Keep talking"
                hint="Closes these choices and returns to the conversation"
                palette={palette}
                onPress={onContinue}
              />
              <RuledSessionAction
                testID="finish-session"
                label="Finish session"
                hint="Ends voice capture and shows the conversation coda"
                palette={palette}
                onPress={onShowCoda}
                secondary
              />
            </>
          ) : (
            <RuledSessionAction
              testID="return-home"
              label="Return home"
              hint="Closes this conversation and returns to Koe home"
              palette={palette}
              onPress={onFinish}
            />
          )}
        </View>
      </SafeAreaScreen>
    </Modal>
  );
}

function RuledSessionAction({
  testID,
  label,
  hint,
  palette,
  onPress,
  secondary = false,
}: {
  testID?: string;
  label: string;
  hint?: string;
  palette: ConversationPalette;
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <WholeAffordancePressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.ruledAction,
        secondary && styles.secondaryRuledAction,
        {
          borderColor: secondary ? palette.hairline : palette.ruleStrong,
          backgroundColor: pressed ? palette.seamSoft : "transparent",
        },
      ]}
    >
      <View
        style={[
          styles.ruledActionContent,
          secondary && styles.secondaryRuledActionContent,
        ]}
      >
        <Text
          maxFontSizeMultiplier={CONTROL_MAX_FONT_SIZE_MULTIPLIER}
          style={[styles.ruledActionText, { color: palette.ink }]}
        >
          {label}
        </Text>
        {!secondary ? (
          <Text
            maxFontSizeMultiplier={CONTROL_MAX_FONT_SIZE_MULTIPLIER}
            style={[styles.ruledActionArrow, { color: palette.seam }]}
          >
            →
          </Text>
        ) : null}
      </View>
    </WholeAffordancePressable>
  );
}

function recoveryHeading(voice: VoiceLifecycle): string {
  if (voice.errorKind === "permissionDenied") {
    return "Koe needs permission to listen.";
  }
  if (voice.errorKind === "silence" || voice.errorKind === "sttFailure") {
    return "Koe did not catch that line.";
  }
  if (voice.errorKind === "playbackFailure") {
    return "Koe could not play its reply.";
  }
  if (voice.errorKind === "audioInterruption") {
    return "The conversation paused.";
  }
  return "Koe lost that part of the exchange.";
}

function codaTitle(count: number): string {
  if (count === 0) return "The conversation can rest here.";
  if (count === 1) return "One moment worth keeping.";
  return `${count} moments worth keeping.`;
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

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    minHeight: 68,
    paddingTop: 12,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
  },
  headerAction: {
    width: 96,
    minHeight: CONVERSATION_TARGET.minimum,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerActionText: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 14,
    lineHeight: 20,
  },
  headerBalance: { width: 96, height: CONVERSATION_TARGET.minimum },
  lockup: {
    flex: 1,
    minHeight: CONVERSATION_TARGET.minimum,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  lockupKanji: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 25,
    lineHeight: 32,
  },
  lockupLatin: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 1.8,
  },
  conversationScroll: { flex: 1 },
  conversationContent: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 620,
    alignSelf: "center",
    paddingHorizontal: 24,
  },
  stage: {
    flexGrow: 1,
    alignItems: "center",
    paddingTop: 4,
    paddingBottom: 20,
  },
  compactStage: { paddingTop: 0, paddingBottom: 12 },
  stateDetail: {
    fontFamily: "Avenir Next",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 330,
    marginTop: 6,
  },
  utterance: {
    width: "100%",
    minHeight: 64,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    marginTop: 24,
    paddingVertical: 14,
  },
  utteranceText: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 20,
    lineHeight: 29,
  },
  firstExchange: { flexGrow: 1 },
  microphoneArt: {
    width: 310,
    height: 240,
    alignSelf: "center",
    marginTop: 8,
  },
  compactMicrophoneArt: { width: 270, height: 202, marginTop: 0 },
  editorialLabel: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 10,
    lineHeight: 15,
    letterSpacing: 1.4,
  },
  displayLarge: {
    fontFamily: "Iowan Old Style",
    fontSize: 36,
    lineHeight: 40,
    marginTop: 10,
  },
  displayMedium: {
    fontFamily: "Iowan Old Style",
    fontSize: 30,
    lineHeight: 35,
    marginTop: 12,
  },
  jpBody: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 17,
    lineHeight: 26,
    marginTop: 8,
  },
  bodyCopy: {
    fontFamily: "Avenir Next",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    maxWidth: 440,
  },
  transcriptPanel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
    paddingBottom: 12,
  },
  panelInstruction: {
    fontFamily: "Avenir Next",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  transcriptInput: {
    minHeight: CONVERSATION_TARGET.action,
    maxHeight: 100,
    borderBottomWidth: 1,
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 18,
    lineHeight: 26,
    paddingHorizontal: 0,
    paddingVertical: 10,
  },
  transcriptActions: { flexDirection: "row", gap: 10, marginTop: 12 },
  transcriptAction: {
    flex: 1,
    minHeight: CONVERSATION_TARGET.action,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  transcriptActionText: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 15,
    lineHeight: 21,
  },
  recoveryBody: { flexGrow: 1, justifyContent: "space-between" },
  recoveryCopy: { flexGrow: 1 },
  recoveryArt: {
    width: 144,
    height: 144,
    alignSelf: "center",
    marginTop: 64,
    marginBottom: 20,
  },
  compactRecoveryArt: { marginTop: 24 },
  recoveryActions: {
    minHeight: 148,
    paddingTop: 24,
    paddingBottom: 12,
  },
  speakDock: {
    width: "100%",
    maxWidth: 620,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 12,
  },
  ruledAction: {
    width: "100%",
    minHeight: 64,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingHorizontal: 2,
    paddingVertical: 12,
    alignItems: "stretch",
    justifyContent: "center",
  },
  secondaryRuledAction: {
    minHeight: CONVERSATION_TARGET.action,
    marginTop: 8,
  },
  ruledActionContent: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  secondaryRuledActionContent: { justifyContent: "center" },
  ruledActionText: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 17,
    lineHeight: 22,
  },
  ruledActionArrow: {
    fontFamily: "Avenir Next",
    fontSize: 24,
    lineHeight: 28,
  },
  correctionMoment: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  correctionCopy: { flex: 1 },
  correctionText: {
    fontFamily: "Avenir Next",
    fontSize: 15,
    lineHeight: 21,
    marginTop: 5,
  },
  noteActions: { flexDirection: "row", gap: 8 },
  inlineAction: {
    width: CONVERSATION_TARGET.minimum,
    height: CONVERSATION_TARGET.minimum,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  closeoutSafeArea: { flex: 1 },
  closeoutHeader: {
    minHeight: 68,
    paddingTop: 12,
    paddingHorizontal: 24,
    flexDirection: "row",
  },
  closeoutScroll: { flex: 1 },
  closeoutBody: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 620,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  endingArt: {
    width: 120,
    height: 96,
    alignSelf: "center",
    marginTop: 76,
    marginBottom: 28,
  },
  codaArt: {
    width: 280,
    height: 180,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 18,
  },
  momentList: {
    marginTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  momentRow: {
    minHeight: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    paddingVertical: 10,
  },
  momentText: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 17,
    lineHeight: 25,
  },
  momentNote: {
    fontFamily: "Avenir Next",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  closeoutActions: {
    width: "100%",
    maxWidth: 620,
    minHeight: 136,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 12,
  },
});
