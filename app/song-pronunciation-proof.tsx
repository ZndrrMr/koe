import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Asset } from "expo-asset";
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  RecordingPresets,
} from "expo-audio";
import {
  Check,
  ChevronRight,
  MessageCircleMore,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  Volume2,
} from "lucide-react-native";

import { MicButton } from "@/components/MicButton";
import { PronunciationFeedbackCard } from "@/components/PronunciationFeedbackCard";
import {
  analyzePronunciation,
  type PronunciationFeedback,
} from "@/services/pitch";
import { startStreaming } from "@/services/stt";
import { play as playAudio, stop as stopAudio } from "@/services/tts";
import {
  SONG_PROTOTYPE_LINE,
  SONG_QUESTIONS,
  advanceSongPrototype,
  answerSongQuestion,
  lineBoundaryAction,
  lineProgress,
  type SongPrototypeStage,
  type SongQuestionID,
} from "@/song/pronunciationPrototype";
import { useConversationPalette } from "@/theme/conversation";
import { CONVERSATION_TARGET } from "@/theme/interaction";
import { fail, success, tap } from "@/utils/haptics";

type TransportMode = "idle" | "song" | "line-once" | "line-loop";

const TRACK_DURATION_SECONDS = 28.94;

export default function SongPronunciationProofScreen() {
  const palette = useConversationPalette();
  const blossom = palette.canvas === "#EEF1ED" ? "#B85F62" : "#D99091";
  const player = useAudioPlayer(
    require("../assets/song-pronunciation-proof/sakura-sakura.mp3"),
    { updateInterval: 40, keepAudioSessionActive: true },
  );
  const playback = useAudioPlayerStatus(player);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [transport, setTransport] = useState<TransportMode>("idle");
  const [stage, setStage] = useState<SongPrototypeStage>("song");
  const [recording, setRecording] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [feedback, setFeedback] = useState<PronunciationFeedback>();
  const [attemptUri, setAttemptUri] = useState("");
  const [referenceUri, setReferenceUri] = useState("");
  const [question, setQuestion] = useState<SongQuestionID>();
  const [completion, setCompletion] = useState("");
  const sttRef = useRef<Awaited<ReturnType<typeof startStreaming>> | null>(
    null,
  );
  const pressStartedAt = useRef(0);
  const boundaryBusy = useRef(false);
  const automaticProofStarted = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const asset = Asset.fromModule(
        require("../assets/song-pronunciation-proof/line-reference.m4a"),
      );
      await asset.downloadAsync();
      if (active) setReferenceUri(asset.localUri ?? asset.uri);
    })();
    return () => {
      active = false;
      void sttRef.current?.cancel();
      void stopAudio();
    };
  }, []);

  useEffect(() => {
    if (transport !== "line-once" && transport !== "line-loop") return;
    const action = lineBoundaryAction({
      currentSeconds: playback.currentTime,
      endSeconds: SONG_PROTOTYPE_LINE.endSeconds,
      looping: transport === "line-loop",
    });
    if (action === "continue" || boundaryBusy.current) return;
    boundaryBusy.current = true;
    if (action === "pause") {
      player.pause();
      setTransport("idle");
      setStage((current) => advanceSongPrototype(current, "imitate"));
      boundaryBusy.current = false;
      return;
    }
    void player
      .seekTo(SONG_PROTOTYPE_LINE.startSeconds, 0, 0)
      .then(() => player.play())
      .finally(() => {
        boundaryBusy.current = false;
      });
  }, [playback.currentTime, player, transport]);

  useEffect(() => {
    if (
      stage === "complete" &&
      transport === "song" &&
      playback.playing &&
      playback.currentTime >= SONG_PROTOTYPE_LINE.endSeconds
    ) {
      setCompletion(
        `PASS · resumed the licensed song at ${formatTime(playback.currentTime)} after the short-line practice loop`,
      );
    }
  }, [playback.currentTime, playback.playing, stage, transport]);

  const stopTrack = useCallback(() => {
    player.pause();
    setTransport("idle");
  }, [player]);

  const playSong = useCallback(async () => {
    tap();
    await stopAudio();
    if (playback.playing && transport === "song") {
      stopTrack();
      return;
    }
    if (playback.currentTime >= TRACK_DURATION_SECONDS - 0.2) {
      await player.seekTo(0, 0, 0);
    }
    setTransport("song");
    setCompletion("");
    player.play();
  }, [playback.currentTime, playback.playing, player, stopTrack, transport]);

  const moveBy = useCallback(
    async (delta: number) => {
      const next = Math.max(
        0,
        Math.min(TRACK_DURATION_SECONDS, playback.currentTime + delta),
      );
      await player.seekTo(next, 0, 0);
    },
    [playback.currentTime, player],
  );

  const chooseLine = useCallback(() => {
    tap();
    setStage((current) => advanceSongPrototype(current, "listen"));
  }, []);

  const playLine = useCallback(
    async (looping: boolean) => {
      tap();
      await stopAudio();
      player.pause();
      boundaryBusy.current = true;
      await player.seekTo(SONG_PROTOTYPE_LINE.startSeconds, 0, 0);
      setTransport(looping ? "line-loop" : "line-once");
      setStage((current) => advanceSongPrototype(current, "imitate"));
      player.play();
      boundaryBusy.current = false;
    },
    [player],
  );

  const compareAttempt = useCallback(
    async (audioUri: string) => {
      if (!referenceUri) return;
      stopTrack();
      setAnalyzing(true);
      try {
        const result = await analyzePronunciation({
          targetText: SONG_PROTOTYPE_LINE.text,
          targetReading: SONG_PROTOTYPE_LINE.reading,
          referenceAudioUri: referenceUri,
          attemptAudioUri: audioUri,
        });
        setAttemptUri(audioUri);
        setFeedback(result);
        setStage((current) => advanceSongPrototype(current, "question"));
        result.status === "aligned" ? success() : fail();
        return result;
      } catch {
        fail();
        Alert.alert(
          "Could not compare that attempt",
          "Sing the whole selected line once, close to the microphone.",
        );
      } finally {
        setAnalyzing(false);
      }
    },
    [referenceUri, stopTrack],
  );

  const useSampleAttempt = useCallback(async () => {
    setAnalyzing(true);
    try {
      const asset = Asset.fromModule(
        require("../assets/song-pronunciation-proof/sample-attempt.m4a"),
      );
      await asset.downloadAsync();
      return await compareAttempt(asset.localUri ?? asset.uri);
    } finally {
      setAnalyzing(false);
    }
  }, [compareAttempt]);

  const beginRecording = useCallback(async () => {
    stopTrack();
    pressStartedAt.current = Date.now();
    setRecording(true);
    try {
      sttRef.current = await startStreaming({ onChunk: () => {}, recorder });
    } catch {
      setRecording(false);
      fail();
    }
  }, [recorder, stopTrack]);

  const finishRecording = useCallback(async () => {
    setRecording(false);
    const handle = sttRef.current;
    sttRef.current = null;
    if (!handle) return;
    if (Date.now() - pressStartedAt.current < 500) {
      await handle.cancel();
      return;
    }
    const attempt = await handle.stop();
    if (!attempt.audioUri) {
      Alert.alert("No recording captured", "Hold through the entire line.");
      return;
    }
    await compareAttempt(attempt.audioUri);
  }, [compareAttempt]);

  const askQuestion = useCallback((id: SongQuestionID) => {
    tap();
    setQuestion(id);
    setStage((current) => advanceSongPrototype(current, "complete"));
  }, []);

  const continueSong = useCallback(async () => {
    tap();
    await stopAudio();
    await player.seekTo(SONG_PROTOTYPE_LINE.endSeconds, 0, 0);
    setStage("complete");
    setTransport("song");
    player.play();
  }, [player]);

  useEffect(() => {
    if (!referenceUri || !playback.isLoaded) return;
    console.info("SONG_PROOF_SCREEN_READY", {
      target: "iOS Simulator",
      trackLoaded: playback.isLoaded,
      referenceLoaded: Boolean(referenceUri),
    });
    if (
      !__DEV__ ||
      process.env.EXPO_PUBLIC_KOE_SONG_AUTOPROOF !== "1" ||
      automaticProofStarted.current
    ) {
      return;
    }
    automaticProofStarted.current = true;
    void (async () => {
      try {
        await player.seekTo(0, 0, 0);
        setTransport("song");
        player.play();
        await waitUntil(
          () => player.currentTime >= 0.25,
          "full-song playback never advanced",
        );
        const fullPlaybackSeconds = player.currentTime;
        stopTrack();

        chooseLine();
        await playLine(true);
        let previousTime = player.currentTime;
        let peakTime = previousTime;
        await waitUntil(() => {
          const currentTime = player.currentTime;
          peakTime = Math.max(peakTime, currentTime);
          const wrapped =
            previousTime >= SONG_PROTOTYPE_LINE.endSeconds - 0.12 &&
            currentTime <= SONG_PROTOTYPE_LINE.startSeconds + 0.2;
          previousTime = currentTime;
          return wrapped;
        }, "selected line never wrapped to its start");
        stopTrack();

        const result = await useSampleAttempt();
        if (!result || result.status !== "aligned") {
          throw new Error("licensed sample attempt did not align");
        }
        askQuestion("repeat");
        const contextualAnswer = answerSongQuestion("repeat");
        if (!contextualAnswer) throw new Error("context answer was empty");

        await continueSong();
        await waitUntil(
          () => player.currentTime >= SONG_PROTOTYPE_LINE.endSeconds + 0.25,
          "song did not resume after the practiced line",
        );
        const evidence = {
          fullPlaybackSeconds: roundSeconds(fullPlaybackSeconds),
          loopPeakSeconds: roundSeconds(peakTime),
          loopRestartSeconds: roundSeconds(SONG_PROTOTYPE_LINE.startSeconds),
          pronunciationStatus: result.status,
          pronunciationScore: result.scores.overall,
          contextualAnswer: true,
          resumedSeconds: roundSeconds(player.currentTime),
        };
        const message = `PASS · native short-line loop ${evidence.loopPeakSeconds.toFixed(2)}→${evidence.loopRestartSeconds.toFixed(2)}s · pronunciation ${evidence.pronunciationScore}/100 · contextual answer shown · song resumed at ${evidence.resumedSeconds.toFixed(2)}s`;
        setCompletion(message);
        console.info("SONG_PROOF_PASS", evidence);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "unknown automatic proof failure";
        setCompletion(`FAIL · ${message}`);
        console.error("SONG_PROOF_FAIL", message);
      }
    })();
  }, [
    askQuestion,
    chooseLine,
    continueSong,
    playback.isLoaded,
    playLine,
    player,
    referenceUri,
    stopTrack,
    useSampleAttempt,
  ]);

  const selectedProgress = lineProgress(playback.currentTime);
  const overallProgress = Math.max(
    0,
    Math.min(1, playback.currentTime / TRACK_DURATION_SECONDS),
  );

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: palette.canvas }]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.masthead}>
          <Text style={[styles.eyebrow, { color: palette.seam }]}>
            ZAN-853 · PERMITTED-CONTENT PROOF
          </Text>
          <Text style={[styles.title, { color: palette.ink }]}>歌のひと息</Text>
          <Text style={[styles.subtitle, { color: palette.muted }]}>
            One line from a song. Listen, imitate, understand, continue.
          </Text>
        </View>

        <View
          style={[
            styles.transport,
            {
              borderColor: palette.hairline,
              backgroundColor: palette.seamSoft,
            },
          ]}
        >
          <View style={styles.trackHeading}>
            <View style={styles.trackCopy}>
              <Text style={[styles.trackTitle, { color: palette.ink }]}>
                さくら さくら
              </Text>
              <Text style={[styles.trackMeta, { color: palette.muted }]}>
                Traditional · performance by Kanohara · CC BY-SA 3.0
              </Text>
            </View>
            <Text
              testID="song-playback-time"
              accessibilityLabel={`Song position ${formatTime(playback.currentTime)} of 0:29`}
              style={[styles.time, { color: palette.seam }]}
            >
              {formatTime(playback.currentTime)} / 0:29
            </Text>
          </View>

          <View
            accessibilityLabel="Song timeline with the selected opening line marked"
            style={[styles.timeline, { backgroundColor: palette.hairline }]}
          >
            <View
              style={[
                styles.played,
                {
                  width: `${overallProgress * 100}%`,
                  backgroundColor: palette.seam,
                },
              ]}
            />
            <View
              style={[
                styles.lineWindow,
                {
                  left: `${(SONG_PROTOTYPE_LINE.startSeconds / TRACK_DURATION_SECONDS) * 100}%`,
                  width: `${((SONG_PROTOTYPE_LINE.endSeconds - SONG_PROTOTYPE_LINE.startSeconds) / TRACK_DURATION_SECONDS) * 100}%`,
                  borderColor: blossom,
                },
              ]}
            />
          </View>

          <View style={styles.transportControls}>
            <RoundControl
              label="Go back 5 seconds"
              palette={palette}
              onPress={() => void moveBy(-5)}
            >
              <RotateCcw color={palette.ink} size={17} />
            </RoundControl>
            <Pressable
              testID="play-full-song"
              accessibilityRole="button"
              accessibilityLabel={
                playback.playing && transport === "song"
                  ? "Pause full song"
                  : "Play full song"
              }
              onPress={() => void playSong()}
              style={({ pressed }) => [
                styles.primaryTransport,
                {
                  backgroundColor: palette.control,
                  opacity: pressed ? 0.76 : 1,
                },
              ]}
            >
              {playback.playing && transport === "song" ? (
                <Pause color={palette.controlText} size={17} />
              ) : (
                <Play color={palette.controlText} size={17} />
              )}
              <Text
                style={[
                  styles.primaryTransportText,
                  { color: palette.controlText },
                ]}
              >
                {playback.playing && transport === "song"
                  ? "Pause"
                  : "Play song"}
              </Text>
            </Pressable>
            <RoundControl
              label="Go forward 5 seconds"
              palette={palette}
              onPress={() => void moveBy(5)}
            >
              <ChevronRight color={palette.ink} size={18} />
            </RoundControl>
          </View>
        </View>

        <Step
          number="一"
          label="Choose one line"
          active={stage === "song"}
          palette={palette}
        >
          <Pressable
            testID="choose-song-line"
            accessibilityRole="button"
            accessibilityLabel="Choose the opening line, sakura sakura"
            accessibilityState={{ selected: stage !== "song" }}
            onPress={chooseLine}
            style={({ pressed }) => [
              styles.lineChoice,
              {
                borderColor: stage === "song" ? blossom : palette.seam,
                backgroundColor: pressed ? palette.seamSoft : "transparent",
              },
            ]}
          >
            <View style={styles.lineChoiceCopy}>
              <Text style={[styles.japaneseLine, { color: palette.ink }]}>
                {SONG_PROTOTYPE_LINE.text}
              </Text>
              <Text style={[styles.lineTiming, { color: palette.muted }]}>
                {formatTime(SONG_PROTOTYPE_LINE.startSeconds)}–
                {formatTime(SONG_PROTOTYPE_LINE.endSeconds)} · 4.32 sec
              </Text>
            </View>
            {stage === "song" ? (
              <ChevronRight color={blossom} size={20} />
            ) : (
              <Check color={palette.success} size={20} />
            )}
          </Pressable>
        </Step>

        {stage !== "song" ? (
          <Step
            number="二"
            label="Listen for the shape"
            active={stage === "listen"}
            palette={palette}
          >
            <View
              style={[styles.meaningLayer, { borderColor: palette.hairline }]}
            >
              <View>
                <Text style={[styles.readingLabel, { color: palette.muted }]}>
                  READING
                </Text>
                <Text style={[styles.reading, { color: palette.ink }]}>
                  sakura sakura
                </Text>
              </View>
              <View
                style={[
                  styles.meaningRule,
                  { backgroundColor: palette.hairline },
                ]}
              />
              <View style={styles.meaningCopy}>
                <Text style={[styles.readingLabel, { color: palette.muted }]}>
                  MEANING
                </Text>
                <Text style={[styles.reading, { color: palette.ink }]}>
                  {SONG_PROTOTYPE_LINE.meaning}
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.lineProgressTrack,
                { backgroundColor: palette.hairline },
              ]}
            >
              <View
                testID="selected-line-progress"
                style={[
                  styles.lineProgressFill,
                  {
                    width: `${selectedProgress * 100}%`,
                    backgroundColor: blossom,
                  },
                ]}
              />
            </View>
            <View style={styles.actionRow}>
              <ActionButton
                testID="listen-once"
                label="Listen once"
                icon={<Volume2 color={palette.ink} size={16} />}
                palette={palette}
                onPress={() => void playLine(false)}
              />
              <ActionButton
                testID="loop-line"
                label={transport === "line-loop" ? "Looping…" : "Loop line"}
                icon={<Repeat2 color={palette.ink} size={16} />}
                selected={transport === "line-loop"}
                palette={palette}
                onPress={() => {
                  if (transport === "line-loop") stopTrack();
                  else void playLine(true);
                }}
              />
            </View>
          </Step>
        ) : null}

        {stage === "imitate" || stage === "question" || stage === "complete" ? (
          <Step
            number="三"
            label="Imitate the line"
            active={stage === "imitate"}
            palette={palette}
          >
            {!feedback ? (
              <View style={styles.imitationActions}>
                <MicButton
                  recording={recording}
                  disabled={analyzing}
                  onPressIn={() => void beginRecording()}
                  onPressOut={() => void finishRecording()}
                  prompt={
                    analyzing
                      ? "Comparing timing and pitch…"
                      : "Hold and sing this line"
                  }
                  palette={palette}
                />
                {__DEV__ ? (
                  <Pressable
                    testID="use-sample-attempt"
                    accessibilityRole="button"
                    accessibilityLabel="Use the licensed sample attempt for simulator verification"
                    disabled={analyzing || !referenceUri}
                    onPress={() => void useSampleAttempt()}
                    style={({ pressed }) => [
                      styles.sampleButton,
                      {
                        borderColor: palette.hairline,
                        backgroundColor: pressed
                          ? palette.seamSoft
                          : "transparent",
                        opacity: analyzing || !referenceUri ? 0.45 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.sampleButtonText,
                        { color: palette.muted },
                      ]}
                    >
                      {analyzing
                        ? "Comparing sample…"
                        : "Use licensed sample attempt"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </Step>
        ) : null}

        {feedback ? (
          <View
            testID="song-pronunciation-feedback"
            style={styles.feedbackWrap}
          >
            <PronunciationFeedbackCard
              feedback={feedback}
              palette={palette}
              attemptAudioUri={attemptUri}
              referenceAudioUri={referenceUri}
              onPlay={(uri) => void playAudio(uri)}
              onRetry={() => {
                setFeedback(undefined);
                setAttemptUri("");
                setQuestion(undefined);
                setStage("imitate");
              }}
              initialExpanded
            />
          </View>
        ) : null}

        {stage === "question" || stage === "complete" ? (
          <Step
            number="四"
            label="Ask what you heard"
            active={stage === "question"}
            palette={palette}
          >
            <View style={styles.questionList}>
              {SONG_QUESTIONS.map((item) => (
                <Pressable
                  key={item.id}
                  testID={`song-question-${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={item.prompt}
                  accessibilityState={{ selected: question === item.id }}
                  onPress={() => askQuestion(item.id)}
                  style={({ pressed }) => [
                    styles.questionButton,
                    {
                      borderColor:
                        question === item.id ? palette.seam : palette.hairline,
                      backgroundColor:
                        question === item.id || pressed
                          ? palette.seamSoft
                          : "transparent",
                    },
                  ]}
                >
                  <MessageCircleMore color={palette.seam} size={17} />
                  <Text style={[styles.questionText, { color: palette.ink }]}>
                    {item.prompt}
                  </Text>
                </Pressable>
              ))}
            </View>
            {question ? (
              <View
                testID="song-context-answer"
                style={[styles.answer, { borderColor: blossom }]}
              >
                <Text style={[styles.answerLabel, { color: blossom }]}>
                  PHRASING NOTE
                </Text>
                <Text style={[styles.answerText, { color: palette.ink }]}>
                  {answerSongQuestion(question)}
                </Text>
              </View>
            ) : null}
          </Step>
        ) : null}

        {question ? (
          <Pressable
            testID="continue-song"
            accessibilityRole="button"
            accessibilityLabel="Continue the song after the selected line"
            onPress={() => void continueSong()}
            style={({ pressed }) => [
              styles.continueButton,
              {
                backgroundColor: palette.control,
                opacity: pressed ? 0.78 : 1,
              },
            ]}
          >
            <Play color={palette.controlText} size={18} />
            <View style={styles.continueCopy}>
              <Text
                style={[styles.continueTitle, { color: palette.controlText }]}
              >
                Continue the song
              </Text>
              <Text
                style={[styles.continueDetail, { color: palette.controlText }]}
              >
                Return to 0:05 and keep listening
              </Text>
            </View>
          </Pressable>
        ) : null}

        {completion ? (
          <Text
            testID="song-proof-status"
            accessibilityRole="summary"
            accessibilityLabel={completion}
            style={[
              styles.completion,
              { color: palette.success, borderColor: palette.success },
            ]}
          >
            {completion}
          </Text>
        ) : null}

        <Text style={[styles.licenseNote, { color: palette.muted }]}>
          Prototype content only. Composition and lyrics are public domain; the
          bundled performance and its two marked adaptations are CC BY-SA 3.0.
          No Apple Music audio or lyric data is copied, cached, analyzed, or
          synchronized.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Step({
  number,
  label,
  active,
  palette,
  children,
}: {
  number: string;
  label: string;
  active: boolean;
  palette: ReturnType<typeof useConversationPalette>;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.step, { borderColor: palette.hairline }]}>
      <View style={styles.stepHeading}>
        <Text
          style={[
            styles.stepNumber,
            { color: active ? palette.proof : palette.muted },
          ]}
        >
          {number}
        </Text>
        <Text style={[styles.stepLabel, { color: palette.ink }]}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

function ActionButton({
  testID,
  label,
  icon,
  selected,
  palette,
  onPress,
}: {
  testID: string;
  label: string;
  icon: React.ReactNode;
  selected?: boolean;
  palette: ReturnType<typeof useConversationPalette>;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          borderColor: selected ? palette.seam : palette.hairline,
          backgroundColor:
            selected || pressed ? palette.seamSoft : "transparent",
        },
      ]}
    >
      {icon}
      <Text style={[styles.actionText, { color: palette.ink }]}>{label}</Text>
    </Pressable>
  );
}

function RoundControl({
  label,
  palette,
  onPress,
  children,
}: {
  label: string;
  palette: ReturnType<typeof useConversationPalette>;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.roundControl,
        {
          borderColor: palette.hairline,
          backgroundColor: pressed ? palette.canvas : "transparent",
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  return `${minutes}:${String(wholeSeconds).padStart(2, "0")}`;
}

async function waitUntil(
  check: () => boolean,
  failureMessage: string,
  timeoutMs = 12_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(failureMessage);
}

function roundSeconds(value: number): number {
  return Math.round(value * 100) / 100;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  masthead: { paddingTop: 20, paddingBottom: 22 },
  eyebrow: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 1.25,
    lineHeight: 14,
  },
  title: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 34,
    fontWeight: "600",
    letterSpacing: 2,
    lineHeight: 45,
    marginTop: 4,
  },
  subtitle: { fontSize: 13, lineHeight: 19, marginTop: 4, maxWidth: 320 },
  transport: { borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  trackHeading: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  trackCopy: { flex: 1 },
  trackTitle: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 18,
    fontWeight: "600",
  },
  trackMeta: { fontSize: 9, lineHeight: 14, marginTop: 2 },
  time: { fontFamily: "SFMono-Medium", fontSize: 10, marginTop: 4 },
  timeline: {
    height: 6,
    marginTop: 16,
    position: "relative",
    overflow: "visible",
  },
  played: { height: 6 },
  lineWindow: {
    position: "absolute",
    top: -4,
    height: 14,
    borderLeftWidth: 2,
    borderRightWidth: 2,
  },
  transportControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 16,
  },
  roundControl: {
    width: CONVERSATION_TARGET.minimum,
    height: CONVERSATION_TARGET.minimum,
    borderRadius: CONVERSATION_TARGET.minimum / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryTransport: {
    minHeight: CONVERSATION_TARGET.action,
    minWidth: 138,
    paddingHorizontal: 20,
    borderRadius: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryTransportText: { fontSize: 13, fontWeight: "700" },
  step: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 18,
    paddingBottom: 20,
  },
  stepHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  stepNumber: {
    width: 26,
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 18,
  },
  stepLabel: { fontSize: 13, fontWeight: "700", letterSpacing: 0.1 },
  lineChoice: {
    minHeight: 76,
    borderWidth: 1,
    borderLeftWidth: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  lineChoiceCopy: { flex: 1 },
  japaneseLine: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 25,
    fontWeight: "600",
    letterSpacing: 2,
  },
  lineTiming: { fontFamily: "SFMono-Regular", fontSize: 9, marginTop: 4 },
  meaningLayer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 70,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "stretch",
  },
  meaningRule: { width: StyleSheet.hairlineWidth, marginHorizontal: 14 },
  meaningCopy: { flex: 1 },
  readingLabel: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1.15,
  },
  reading: { fontSize: 12, lineHeight: 18, marginTop: 5 },
  lineProgressTrack: { height: 3, marginTop: 13, overflow: "hidden" },
  lineProgressFill: { height: 3 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  actionButton: {
    flex: 1,
    minHeight: CONVERSATION_TARGET.action,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  actionText: { fontSize: 12, fontWeight: "700" },
  imitationActions: { gap: 8 },
  sampleButton: {
    minHeight: CONVERSATION_TARGET.minimum,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  sampleButtonText: { fontFamily: "SFMono-Medium", fontSize: 9 },
  feedbackWrap: { marginHorizontal: -16, paddingBottom: 10 },
  questionList: { gap: 8 },
  questionButton: {
    minHeight: CONVERSATION_TARGET.action,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  questionText: { flex: 1, fontSize: 12, fontWeight: "600" },
  answer: { borderLeftWidth: 3, paddingLeft: 12, marginTop: 14 },
  answerLabel: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1.2,
  },
  answerText: { fontSize: 13, lineHeight: 20, marginTop: 5 },
  continueButton: {
    minHeight: 66,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  continueCopy: { flex: 1 },
  continueTitle: { fontSize: 14, fontWeight: "700" },
  continueDetail: { fontSize: 10, lineHeight: 14, opacity: 0.66, marginTop: 2 },
  completion: {
    borderLeftWidth: 3,
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    lineHeight: 15,
    paddingLeft: 10,
    marginTop: 14,
  },
  licenseNote: { fontSize: 9, lineHeight: 15, marginTop: 20 },
});
